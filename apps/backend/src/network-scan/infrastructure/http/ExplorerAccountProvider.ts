import type { ExplorerAccountProviderConfig } from '../../../core/config/ExplorerAccountProviderConfig.js';
import { fetchExplorerAccount, type ExplorerAccountDTO } from './ExplorerAccountClient.js';
import { HorizonAccountReadError } from './HorizonAccountResponse.js';

// Per router/process, not a distributed provider quota. No queue, timers or writes.
export const accountProviderLimits = Object.freeze({
	active: 4, waiters: 64, entries: 32, bytes: 8 * 1024 * 1024,
	valueBytes: 2 * 1024 * 1024, ttlMs: 20_000, absentTtlMs: 5_000,
	burst: 1, refillMs: 5_000
});

export class ExplorerAccountProviderError extends Error {
	constructor(readonly status: 429 | 503, readonly retryAfterSeconds: number) {
		super('Account provider temporarily unavailable');
	}
}

type Value = ExplorerAccountDTO | null;
interface Entry {
	readonly controller: AbortController;
	readonly promise: Promise<Value>;
	waiters: number;
	settled: boolean;
}
interface Cached { readonly value: Value; readonly bytes: number; readonly until: number }

/** Explicit alternate only: callers never select an authority or trigger failover. */
export function createExplorerAccountProvider(
	config: ExplorerAccountProviderConfig,
	networkPassphrase: string,
	options: { readonly now?: () => number; readonly fetchAccount?: typeof fetchExplorerAccount } = {}
): { readonly provider: NonNullable<ExplorerAccountDTO['provider']>; readonly read: (account: string, signal: AbortSignal) => Promise<Value> } {
	const now = options.now ?? Date.now;
	const fetchAccount = options.fetchAccount ?? fetchExplorerAccount;
	const provider = Object.freeze({ mode: 'operator_alternate' as const, hostname: config.hostname });
	const running = new Map<string, Entry>(), cached = new Map<string, Cached>();
	let cachedBytes = 0, waiters = 0, failures = 0, retryAt = 0;
	let tokens = Number(accountProviderLimits.burst), tokenTime = now();
	const remove = (key: string): void => {
		const item = cached.get(key);
		if (item) cachedBytes -= item.bytes;
		cached.delete(key);
	};
	const prune = (): void => {
		for (const [key, item] of cached) if (item.until <= now()) remove(key);
	};
	const remember = (key: string, value: Value): void => {
		const bytes = Buffer.byteLength(JSON.stringify(value));
		if (bytes > accountProviderLimits.valueBytes) throw new HorizonAccountReadError();
		prune();
		while (cached.size >= accountProviderLimits.entries || cachedBytes + bytes > accountProviderLimits.bytes) {
			const oldest = cached.keys().next().value;
			if (oldest === undefined) break;
			remove(oldest);
		}
		cached.set(key, { value, bytes, until: now() + (value ? accountProviderLimits.ttlMs : accountProviderLimits.absentTtlMs) });
		cachedBytes += bytes;
	};
	const join = (entry: Entry, signal: AbortSignal): Promise<Value> => {
		if (waiters >= accountProviderLimits.waiters || entry.controller.signal.aborted)
			return Promise.reject(new ExplorerAccountProviderError(429, 1));
		waiters++; entry.waiters++;
		return new Promise((resolve, reject) => {
			let released = false;
			const release = (): boolean => {
				if (released) return false;
				released = true;
				signal.removeEventListener('abort', abort);
				waiters--; entry.waiters--;
				if (!entry.waiters && !entry.settled) entry.controller.abort();
				return true;
			};
			const abort = (): void => { if (release()) reject(signal.reason); };
			signal.addEventListener('abort', abort, { once: true });
			entry.promise.then(value => { if (release()) resolve(value); }, error => { if (release()) reject(error); });
			if (signal.aborted) abort();
		});
	};
	const read = async (account: string, signal: AbortSignal): Promise<Value> => {
		signal.throwIfAborted();
		prune();
		const item = cached.get(account);
		if (item) {
			cached.delete(account); cached.set(account, item);
			return item.value;
		}
		const existing = running.get(account);
		if (existing) return join(existing, signal);
		if (retryAt > now()) throw new ExplorerAccountProviderError(503, Math.max(1, Math.ceil((retryAt - now()) / 1000)));
		const refill = Math.floor(Math.max(0, now() - tokenTime) / accountProviderLimits.refillMs);
		if (refill) { tokens = Math.min(accountProviderLimits.burst, tokens + refill); tokenTime += refill * accountProviderLimits.refillMs; }
		if (running.size >= accountProviderLimits.active || waiters >= accountProviderLimits.waiters || tokens < 1)
			throw new ExplorerAccountProviderError(429, tokens < 1
				? Math.max(1, Math.ceil((accountProviderLimits.refillMs - (now() - tokenTime)) / 1000)) : 2);
		tokens--;
		const controller = new AbortController();
		const entry: Entry = { controller, waiters: 0, settled: false,
			promise: Promise.resolve().then(() => {
				controller.signal.throwIfAborted();
				return fetchAccount(config.url, account, { networkPassphrase, signal: controller.signal });
			}).then(accountValue => {
				controller.signal.throwIfAborted();
				const value = accountValue ? { ...accountValue, provider: { ...provider, observedAt: new Date(now()).toISOString() } } : null;
				remember(account, value);
				failures = 0;
				return value;
			}).catch((error: unknown) => {
				if (controller.signal.aborted) throw controller.signal.reason;
				failures = Math.min(5, failures + 1);
				const delay = Math.max(Math.min(60, 5 * 2 ** (failures - 1)), error instanceof HorizonAccountReadError ? error.retryAfterSeconds : 5);
				retryAt = Math.max(retryAt, now() + delay * 1000);
				throw new ExplorerAccountProviderError(503, Math.max(1, Math.ceil((retryAt - now()) / 1000)));
			}).finally(() => {
				entry.settled = true;
				if (running.get(account) === entry) running.delete(account);
			})
		};
		running.set(account, entry);
		return join(entry, signal);
	};
	return { provider, read };
}

import type { SafeResponse } from '../asset-metadata/safeHttp.js';
import { normalizeIssuerDomain } from '../issuer-domains/IssuerDomainCache.js';

const windowMs = 60_000;
const requestsPerWindow = 8;
const concurrentPerProvider = 2;
const maxProviders = 256;

export class FederationThrottled extends Error {
	constructor(readonly retryAtMs: number) {
		super('Federation provider request budget exhausted');
	}
}

/** Route outbound requests from all callers through one budget owner. */
export interface FederationProviderBudget {
	run(
		providerHost: string,
		request: () => Promise<SafeResponse>,
		signal?: AbortSignal
	): Promise<SafeResponse>;
}

export interface FederationSchedule {
	windowUntil: number;
	requests: number;
	active: number;
	failures: number;
	retryAt: number;
}

export interface FederationScheduleStore {
	update<T>(
		work: (schedules: Map<string, FederationSchedule>) => T,
		mode?: 'completion'
	): Promise<T>;
}

/** Process-local scheduler for a single outbound owner. It retains no response or account data. */
export class LocalFederationScheduleStore implements FederationScheduleStore {
	private readonly schedules = new Map<string, FederationSchedule>();

	async update<T>(
		work: (schedules: Map<string, FederationSchedule>) => T
	): Promise<T> {
		return work(this.schedules);
	}
}

export class ScheduledFederationProviderBudget implements FederationProviderBudget {
	constructor(
		private readonly store: FederationScheduleStore,
		private readonly now: () => number = Date.now
	) {}

	async run(
		providerHost: string,
		request: () => Promise<SafeResponse>,
		signal?: AbortSignal
	): Promise<SafeResponse> {
		if (
			providerHost.length > 253 ||
			normalizeIssuerDomain(providerHost) !== providerHost
		)
			throw new Error('Invalid federation schedule provider');
		await this.store.update((schedules) => {
			signal?.throwIfAborted();
			const now = this.now();
			const schedule = this.schedule(schedules, providerHost, now);
			if (schedule.retryAt > now)
				throw new FederationThrottled(schedule.retryAt);
			if (schedule.active >= concurrentPerProvider)
				throw new FederationThrottled(now + 1000);
			if (schedule.windowUntil <= now) {
				schedule.windowUntil = now + windowMs;
				schedule.requests = 0;
			}
			if (schedule.requests >= requestsPerWindow)
				throw new FederationThrottled(schedule.windowUntil);
			schedule.requests++;
			schedule.active++;
		});
		let response: SafeResponse | undefined;
		try {
			signal?.throwIfAborted();
			response = await request();
			return response;
		} finally {
			const status = response?.status;
			const completedAt = this.now();
			const retryAt = await waitForCompletion(
				this.complete(
					providerHost,
					status,
					completedAt,
					retryAfter(response?.headers['retry-after'], completedAt)
				),
				signal
			);
			if (status === 429) throw new FederationThrottled(retryAt);
		}
	}

	private complete(
		providerHost: string,
		status: number | undefined,
		completedAt: number,
		providerRetryAt: number
	): Promise<number> {
		// Only scheduling metadata survives a caller deadline.
		return this.store.update((schedules) => {
			const schedule = schedules.get(providerHost);
			if (!schedule || schedule.active < 1)
				throw new Error('Federation request schedule unavailable');
			schedule.active--;
			if (
				status === undefined ||
				status === 429 ||
				status === 408 ||
				status >= 500
			)
				this.backOff(schedule, completedAt, providerRetryAt);
			else if (schedule.retryAt <= completedAt) schedule.failures = 0;
			return schedule.retryAt;
		}, 'completion');
	}

	private schedule(
		schedules: Map<string, FederationSchedule>,
		host: string,
		now: number
	): FederationSchedule {
		const existing = schedules.get(host);
		if (existing) return existing;
		if (schedules.size >= maxProviders) {
			for (const [key, value] of schedules) {
				if (
					value.active === 0 &&
					value.windowUntil <= now &&
					value.retryAt <= now
				)
					schedules.delete(key);
			}
			if (schedules.size >= maxProviders)
				throw new FederationThrottled(now + windowMs);
		}
		const schedule = {
			windowUntil: now + windowMs,
			requests: 0,
			active: 0,
			failures: 0,
			retryAt: 0
		};
		schedules.set(host, schedule);
		return schedule;
	}

	private backOff(
		schedule: FederationSchedule,
		completedAt: number,
		providerRetryAt: number
	): void {
		schedule.failures = Math.min(schedule.failures + 1, 7);
		const fallback =
			completedAt + Math.min(60_000, 1000 * 2 ** (schedule.failures - 1));
		schedule.retryAt = Math.max(schedule.retryAt, fallback, providerRetryAt);
	}
}

async function waitForCompletion<T>(
	completion: Promise<T>,
	signal?: AbortSignal
): Promise<T> {
	if (!signal) return completion;
	let abort!: () => void;
	const deadline = new Promise<never>((_resolve, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
	});
	try {
		return await Promise.race([deadline, completion]);
	} finally {
		signal.removeEventListener('abort', abort);
	}
}

export class LocalFederationProviderBudget extends ScheduledFederationProviderBudget {
	constructor(now: () => number = Date.now) {
		super(new LocalFederationScheduleStore(), now);
	}
}

function retryAfter(value: string | undefined, now: number): number {
	if (!value) return 0;
	if (/^[0-9]+$/.test(value))
		return Math.min(Number.MAX_SAFE_INTEGER, now + Number(value) * 1000);
	const date = Date.parse(value);
	return Number.isFinite(date) && new Date(date).toUTCString() === value
		? date
		: 0;
}

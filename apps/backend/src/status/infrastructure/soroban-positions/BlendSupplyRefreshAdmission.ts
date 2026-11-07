import { StrKey } from '@stellar/stellar-sdk';
import { performance } from 'node:perf_hooks';
import {
	fetchProvenanceJson,
	ProvenanceHttpError
} from '../http/contract-provenance/BoundedProvenanceJson.js';
import { blendFixedSupplyTarget } from './BlendFixedSupply.js';
import { produceBlendSupplyEvidence } from './BlendSupplyEvidenceProducer.js';
import type { PositionSnapshot } from './TimelockPositions.js';

const maxActive = 2;
const callsPerRefresh = 3;
const maxCalls = 6;
const requestWindowMs = 10_000;
const maxSettled = 4;
const completedTtlMs = 30_000;
const errorTtlMs = 5_000;
const defaultCooldownMs = 30_000;
const minCooldownMs = 1_000;
const ledgerHashPattern = /^[0-9a-f]{64}$/;
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const months = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];
const imfDate =
	/^(?<weekday>[A-Z][a-z]{2}), (?<day>\d{2}) (?<month>[A-Z][a-z]{2}) (?<year>\d{4}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) GMT$/;
const rfc850Date =
	/^(?<weekday>Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (?<day>\d{2})-(?<month>[A-Z][a-z]{2})-(?<year>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) GMT$/;
const asctimeDate =
	/^(?<weekday>[A-Z][a-z]{2}) (?<month>[A-Z][a-z]{2}) (?<day>\d{2}| \d) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) (?<year>\d{4})$/;

type Selection = {
	readonly accountId: string;
	readonly snapshot: PositionSnapshot;
};

type Observation = Awaited<ReturnType<typeof produceBlendSupplyEvidence>>;
type RateLimit = {
	readonly retryAfter: string | null;
	readonly retryAt: number;
};
type Completed = {
	readonly status: 'completed';
	readonly observation: Observation;
	readonly completedAt: number;
};
type Failed = { readonly status: 'error' } & (
	| { readonly reason: 'provider_error' }
	| ({ readonly reason: 'rate_limited' } & RateLimit)
);
type Settled = Completed | Failed;
type Deferred = { readonly status: 'deferred' } & (
	| { readonly reason: 'provider_busy' | 'request_budget' }
	| ({ readonly reason: 'provider_cooldown' } & RateLimit)
);
type RefreshResult = Settled | Deferred;
type RefreshState =
	Settled | { readonly status: 'unknown' } | { readonly status: 'pending' };

class ProviderCooldown extends Error {
	constructor(readonly rateLimit: RateLimit) {
		super('Blend provider refresh is cooling down');
	}
}

/**
 * One shared process-local instance per authorized provider quota.
 * getState is a cache-only read. refresh is an explicit admission request.
 * A subscriber can discard its promise while the shared operation continues.
 * Completed output is transient and still requires durable evidence retention.
 */
export function createBlendSupplyRefreshAdmission(
	rpcUrl: string,
	{
		request = fetchProvenanceJson,
		monotonicNow = () => performance.now(),
		wallNow = Date.now
	}: {
		readonly request?: typeof fetchProvenanceJson;
		readonly monotonicNow?: () => number;
		readonly wallNow?: () => number;
	} = {}
): {
	getState(selection: Selection): RefreshState;
	refresh(selection: Selection): Promise<RefreshResult>;
} {
	const endpoint = new URL(rpcUrl);
	if (
		endpoint.protocol !== 'https:' ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash
	)
		throw new Error('Invalid Blend refresh provider');

	const pending = new Map<string, Promise<Settled>>();
	const settled = new Map<string, { state: Settled; expiresAt: number }>();
	const outbound: number[] = [];
	let reserved = 0;
	let cooldown: { until: number; retryAfter: string | null } | undefined;

	function prune(now: number): void {
		while (outbound[0] !== undefined && now - outbound[0] >= requestWindowMs)
			outbound.shift();
		for (const [key, entry] of settled) {
			if (entry.expiresAt <= now) settled.delete(key);
		}
		if (cooldown && cooldown.until <= now) cooldown = undefined;
	}

	function cooldownInfo(now: number): RateLimit | undefined {
		if (!cooldown || cooldown.until <= now) return undefined;
		return {
			retryAfter: cooldown.retryAfter,
			retryAt: Math.min(
				Number.MAX_SAFE_INTEGER,
				wallNow() + Math.ceil(cooldown.until - now)
			)
		};
	}

	function recordRateLimit(retryAfter: string | null): RateLimit {
		const now = monotonicNow();
		const wall = wallNow();
		const delay = retryDelay(retryAfter, wall);
		const until = now + Math.max(minCooldownMs, delay);
		if (!cooldown || until > cooldown.until) cooldown = { until, retryAfter };
		return {
			retryAfter,
			retryAt: Math.min(
				Number.MAX_SAFE_INTEGER,
				wall + Math.ceil(cooldown.until - now)
			)
		};
	}

	function save(key: string, state: Settled): void {
		const now = monotonicNow();
		prune(now);
		if (settled.size >= maxSettled) {
			const oldest = settled.keys().next().value;
			if (oldest !== undefined) settled.delete(oldest);
		}
		let ttl = state.status === 'completed' ? completedTtlMs : errorTtlMs;
		if (state.status === 'error' && state.reason === 'rate_limited' && cooldown)
			ttl = Math.min(ttl, cooldown.until - now);
		settled.set(key, { state, expiresAt: now + ttl });
	}

	function start(selection: Selection, key: string): Promise<Settled> {
		let remaining = callsPerRefresh;
		reserved += remaining;

		const admittedRequest: typeof fetchProvenanceJson = async (...args) => {
			const now = monotonicNow();
			const blocked = cooldownInfo(now);
			if (blocked) throw new ProviderCooldown(blocked);
			if (remaining <= 0)
				throw new Error('Blend refresh exceeded its RPC reservation');
			prune(now);
			remaining--;
			reserved--;
			// Charge transport invocations, including failures and agent-queued work.
			outbound.push(now);
			try {
				return await request(...args);
			} catch (error) {
				if (error instanceof ProvenanceHttpError && error.status === 429) {
					throw new ProviderCooldown(recordRateLimit(error.retryAfter));
				}
				throw error;
			}
		};

		// Install the shared operation before the transport can run or re-enter.
		const operation = Promise.resolve().then(async (): Promise<Settled> => {
			let state: Settled;
			try {
				const observation = await produceBlendSupplyEvidence(
					{
						rpcUrl: endpoint.href,
						accountId: selection.accountId,
						snapshot: selection.snapshot
					},
					admittedRequest
				);
				state = { status: 'completed', observation, completedAt: wallNow() };
			} catch (error) {
				state =
					error instanceof ProviderCooldown
						? { status: 'error', reason: 'rate_limited', ...error.rateLimit }
						: { status: 'error', reason: 'provider_error' };
			} finally {
				reserved -= remaining;
				pending.delete(key);
			}
			save(key, state);
			return state;
		});
		pending.set(key, operation);
		return operation;
	}

	return {
		getState(selection) {
			const key = selectionKey(selection);
			prune(monotonicNow());
			if (pending.has(key)) return { status: 'pending' };
			return settled.get(key)?.state ?? { status: 'unknown' };
		},
		refresh(selection) {
			const key = selectionKey(selection);
			const now = monotonicNow();
			prune(now);
			const inFlight = pending.get(key);
			if (inFlight) return inFlight;
			const cached = settled.get(key)?.state;
			if (cached) return Promise.resolve(cached);
			const blocked = cooldownInfo(now);
			if (blocked)
				return Promise.resolve({
					status: 'deferred',
					reason: 'provider_cooldown',
					...blocked
				});
			if (pending.size >= maxActive)
				return Promise.resolve({ status: 'deferred', reason: 'provider_busy' });
			// Reserve every stage before admitting an operation. Unused slots are
			// released on failure; consumed slots age out from transport invocation.
			if (outbound.length + reserved + callsPerRefresh > maxCalls)
				return Promise.resolve({
					status: 'deferred',
					reason: 'request_budget'
				});
			return start(
				{ accountId: selection.accountId, snapshot: { ...selection.snapshot } },
				key
			);
		}
	};
}

function selectionKey({ accountId, snapshot }: Selection): string {
	if (
		accountId.length !== 56 ||
		!StrKey.isValidEd25519PublicKey(accountId) ||
		snapshot.networkId !== blendFixedSupplyTarget.networkId ||
		!Number.isInteger(snapshot.ledger) ||
		snapshot.ledger <= 0 ||
		snapshot.ledger > 0xffff_ffff ||
		!ledgerHashPattern.test(snapshot.ledgerHash)
	)
		throw new Error('Invalid Blend refresh selection');

	return JSON.stringify([accountId, snapshot.ledger, snapshot.ledgerHash]);
}

function retryDelay(retryAfter: string | null, wallTime: number): number {
	const value = retryAfter?.trim();
	if (!value) return defaultCooldownMs;
	if (/^[0-9]+$/.test(value))
		return Math.min(Number(value) * 1_000, Number.MAX_SAFE_INTEGER);
	const date = parseHttpDate(value, wallTime);
	return date === undefined ? defaultCooldownMs : Math.max(0, date - wallTime);
}

function parseHttpDate(value: string, wallTime: number): number | undefined {
	const parts =
		imfDate.exec(value)?.groups ??
		rfc850Date.exec(value)?.groups ??
		asctimeDate.exec(value)?.groups;
	if (!parts) return undefined;
	const month = months.indexOf(parts.month!);
	const weekday = weekdays.indexOf(parts.weekday!.slice(0, 3));
	const day = Number(parts.day);
	const hour = Number(parts.hour);
	const minute = Number(parts.minute);
	const second = Number(parts.second);
	let year = Number(parts.year);
	if (
		month < 0 ||
		weekday < 0 ||
		day < 1 ||
		day > 31 ||
		hour > 23 ||
		minute > 59 ||
		second > 60 ||
		(second === 60 && (hour !== 23 || minute !== 59))
	)
		return undefined;

	const date = new Date(0);
	date.setUTCHours(hour, minute, Math.min(second, 59));
	if (parts.year!.length === 2) {
		const limit = new Date(wallTime);
		const currentYear = limit.getUTCFullYear();
		year += Math.floor(currentYear / 100) * 100;
		if (year < currentYear) year += 100;
		limit.setUTCFullYear(currentYear + 50);
		if (date.setUTCFullYear(year, month, day) > limit.getTime()) year -= 100;
	}
	date.setUTCFullYear(year, month, day);
	if (
		date.getUTCMonth() !== month ||
		date.getUTCDate() !== day ||
		date.getUTCDay() !== weekday
	)
		return undefined;
	return date.getTime() + (second === 60 ? 1_000 : 0);
}

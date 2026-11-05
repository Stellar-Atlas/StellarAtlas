import { createHash } from 'node:crypto';
import type { HubbleAccountBalancePage } from './HubbleAccountBalanceContracts.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';

type Outcome =
	| { readonly ok: true; readonly page: HubbleAccountBalancePage }
	| { readonly ok: false; readonly error: unknown };
type Waiter = (outcome: Outcome) => void;

const maximumFlights = 4;
const maximumWaiters = 32;
const maximumRetained = 32;
const maximumRetainedCoverageRanges = 1_024;
const resultMilliseconds = 30_000;
const failureMilliseconds = 5_000;

/** One warehouse instance (one configured database/network), not a cluster cache. */
export class HubbleAccountBalanceFlights {
	constructor(private readonly now: () => number = () => performance.now()) {}

	private readonly active = new Map<string, Set<Waiter>>();
	private readonly recent = new Map<
		string,
		{ readonly until: number; readonly outcome: Outcome }
	>();

	async run(
		key: string,
		signal: AbortSignal | undefined,
		work: (queryId: string) => Promise<HubbleAccountBalancePage>
	): Promise<HubbleAccountBalancePage> {
		signal?.throwIfAborted();
		const now = this.now();
		for (const [name, record] of this.recent)
			if (record.until <= now) this.recent.delete(name);
		const retained = this.recent.get(key)?.outcome;
		if (retained !== undefined) {
			if (retained.ok) return retained.page;
			throw retained.error;
		}
		let waiters = this.active.get(key);
		if (waiters === undefined) {
			if (this.active.size >= maximumFlights)
				throw new HubbleWarehouseUnavailableError(
					'Account balance query capacity is temporarily busy'
				);
			waiters = new Set();
			this.active.set(key, waiters);
			const owned = waiters;
			// The same authenticated ClickHouse user/server can reject an overlapping
			// ID without replacing the original, even across API processes.
			const queryId =
				'atlas-account-balances-v1-' +
				createHash('sha256').update(key).digest('hex');
			void Promise.resolve()
				.then(() => work(queryId))
				.then(
					(page) => this.finish(key, owned, { ok: true, page }),
					(error: unknown) => this.finish(key, owned, { ok: false, error })
				);
		}
		if (waiters.size >= maximumWaiters)
			throw new HubbleWarehouseUnavailableError(
				'Account balance query waiters are temporarily full'
			);
		return new Promise((resolve, reject) => {
			const current = waiters;
			const onAbort = (): void => {
				current.delete(finish);
				reject(signal?.reason);
			};
			const finish: Waiter = (outcome) => {
				signal?.removeEventListener('abort', onAbort);
				if (outcome.ok) resolve(outcome.page);
				else reject(outcome.error);
			};
			current.add(finish);
			signal?.addEventListener('abort', onAbort, { once: true });
		});
	}

	private finish(key: string, waiters: Set<Waiter>, outcome: Outcome): void {
		this.active.delete(key);
		// Do not retain an unusually fragmented coverage snapshot. Active work
		// remains shareable irrespective of coverage shape.
		if (
			!outcome.ok ||
			(outcome.page.coverage.completedRanges?.length ?? 0) <=
				maximumRetainedCoverageRanges
		) {
			if (this.recent.size >= maximumRetained)
				this.recent.delete(this.recent.keys().next().value!);
			this.recent.set(key, {
				until:
					this.now() + (outcome.ok ? resultMilliseconds : failureMilliseconds),
				outcome
			});
		}
		for (const waiter of waiters) waiter(outcome);
		waiters.clear();
	}
}

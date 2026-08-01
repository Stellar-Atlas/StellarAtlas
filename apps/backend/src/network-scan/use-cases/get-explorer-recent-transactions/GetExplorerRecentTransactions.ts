import type {
	ExplorerRecentTransactionV1,
	ExplorerRecentTransactionsV1,
	ExplorerTransactionFeedFreshnessV1,
	ExplorerTransactionFeedSelectionReasonV1
} from 'shared';
import type { GetExplorerLocalTransactions } from '../get-explorer-local-transactions/GetExplorerLocalTransactions.js';

interface ExplorerTransactionRecordInput {
	readonly createdAt: string;
	readonly feeCharged: string;
	readonly hash: string;
	readonly ledger: string;
	readonly operationCount: number;
	readonly sourceAccount: string;
	readonly successful: boolean;
}

export interface ExplorerLiveTransactionFeed {
	readonly records: readonly ExplorerTransactionRecordInput[];
	readonly truncated: boolean;
}

export interface GetExplorerRecentTransactionsConfig {
	readonly fetchLiveTransactions: (
		limit: number
	) => Promise<ExplorerLiveTransactionFeed>;
	readonly freshnessWindowMs: number;
	readonly getLocalTransactions: Pick<GetExplorerLocalTransactions, 'execute'>;
	readonly now: () => Date;
}

export class GetExplorerRecentTransactions {
	constructor(private readonly config: GetExplorerRecentTransactionsConfig) {
		if (
			!Number.isSafeInteger(config.freshnessWindowMs) ||
			config.freshnessWindowMs <= 0
		) {
			throw new RangeError('Explorer transaction freshness window must be positive');
		}
	}

	async execute(limit: number): Promise<ExplorerRecentTransactionsV1> {
		const local = await this.config.getLocalTransactions.execute(limit);
		const assessedAt = this.readNow();
		const localDataThrough = normalizeDateTime(
			local.canonicalCoverage?.latestLedgerClosedAt ?? null
		);
		if (
			local.records.length > 0 &&
			classifyFreshness(
				localDataThrough,
				assessedAt,
				this.config.freshnessWindowMs
			) === 'fresh'
		) {
			return this.mapLocalFeed(
				local,
				localDataThrough,
				assessedAt,
				'fresh',
				'local_history_current'
			);
		}

		const fallbackReason: ExplorerTransactionFeedSelectionReasonV1 =
			local.records.length === 0
				? 'local_history_empty'
				: 'local_history_behind';
		try {
			const live = await this.config.fetchLiveTransactions(limit);
			const generatedAt = this.readNow();
			const dataThrough = latestRecordTime(live.records);
			return {
				dataThrough,
				freshness: classifyFreshness(
					dataThrough,
					generatedAt,
					this.config.freshnessWindowMs
				),
				freshnessThresholdMs: this.config.freshnessWindowMs,
				generatedAt: generatedAt.toISOString(),
				limit,
				records: live.records.map(mapTransaction),
				selectionReason: fallbackReason,
				source: 'live_network',
				truncated: live.truncated
			};
		} catch (error: unknown) {
			if (local.records.length === 0) throw error;
			return this.mapLocalFeed(
				local,
				localDataThrough,
				this.readNow(),
				'stale',
				'live_network_unavailable'
			);
		}
	}

	private mapLocalFeed(
		local: Awaited<
			ReturnType<
				GetExplorerRecentTransactionsConfig['getLocalTransactions']['execute']
			>
		>,
		dataThrough: string | null,
		generatedAt: Date,
		freshness: ExplorerTransactionFeedFreshnessV1,
		selectionReason: ExplorerTransactionFeedSelectionReasonV1
	): ExplorerRecentTransactionsV1 {
		return {
			dataThrough,
			freshness,
			freshnessThresholdMs: this.config.freshnessWindowMs,
			generatedAt: generatedAt.toISOString(),
			limit: local.limit,
			records: local.records.map(mapTransaction),
			selectionReason,
			source: 'local_history',
			truncated: local.truncated
		};
	}

	private readNow(): Date {
		const now = this.config.now();
		if (!Number.isFinite(now.valueOf()))
			throw new Error('Explorer clock is invalid');
		return new Date(now);
	}
}

function mapTransaction(
	record: ExplorerTransactionRecordInput
): ExplorerRecentTransactionV1 {
	return {
		createdAt: record.createdAt,
		feeCharged: record.feeCharged,
		hash: record.hash,
		ledger: record.ledger,
		operationCount: record.operationCount,
		sourceAccount: record.sourceAccount,
		successful: record.successful
	};
}

function classifyFreshness(
	dataThrough: string | null,
	now: Date,
	freshnessWindowMs: number
): ExplorerTransactionFeedFreshnessV1 {
	if (dataThrough === null) return 'unknown';
	const ageMs = now.valueOf() - Date.parse(dataThrough);
	return ageMs >= 0 && ageMs <= freshnessWindowMs ? 'fresh' : 'stale';
}

function latestRecordTime(
	records: readonly ExplorerTransactionRecordInput[]
): string | null {
	let latestMs: number | null = null;
	for (const record of records) {
		const parsed = Date.parse(record.createdAt);
		if (!Number.isFinite(parsed)) {
			throw new TypeError(
				'Live transaction feed contains an invalid timestamp'
			);
		}
		if (latestMs === null || parsed > latestMs) latestMs = parsed;
	}
	return latestMs === null ? null : new Date(latestMs).toISOString();
}

function normalizeDateTime(value: string | null): string | null {
	if (value === null) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

import type { FullHistoryLedgerCloseMetaSha256Digest } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type {
	FullHistoryLedgerProjection,
	FullHistoryStateCanonicalCoverageClaim,
	FullHistoryStateCanonicalCoverageReceipt,
	FullHistoryStateCanonicalCoverageRepository
} from '../../domain/full-history-state-import/FullHistoryLedgerProjection.js';
import { verifiedFullHistoryDatasetPath } from '../full-history-dataset/VerifiedFullHistoryDatasetPath.js';
import {
	runWithFullHistoryBackfillLease,
	type FullHistoryBackfillLeaseTerminal
} from '../run-full-history-backfill/FullHistoryBackfillLeaseKeeper.js';

export interface FullHistoryLedgerExporter {
	export(input: {
		readonly consumeRow: (row: FullHistoryLedgerProjection) => Promise<void>;
		readonly expectedSourceSha256: FullHistoryLedgerCloseMetaSha256Digest;
		readonly inputPath: string;
		readonly signal: AbortSignal;
	}): Promise<{
		readonly recordCount: bigint;
		readonly sourceSha256: FullHistoryLedgerCloseMetaSha256Digest;
	}>;
}

export interface BindNextFullHistoryStateCoverageConfig {
	readonly insertBatchSize: number;
	readonly leaseDurationMilliseconds: number;
	readonly storageRoot: string;
	readonly workerId: string;
}

export class BindNextFullHistoryStateCoverage {
	constructor(
		private readonly repository: FullHistoryStateCanonicalCoverageRepository,
		private readonly exporter: FullHistoryLedgerExporter,
		private readonly config: BindNextFullHistoryStateCoverageConfig
	) {
		if (
			!Number.isInteger(config.insertBatchSize) ||
			config.insertBatchSize < 1 ||
			config.insertBatchSize > 500
		) {
			throw new TypeError('Coverage insert batch size must be 1 to 500');
		}
	}

	async execute(
		signal: AbortSignal
	): Promise<FullHistoryStateCanonicalCoverageReceipt | null> {
		await this.repository.registerPendingCoverage();
		const claim = await this.repository.claimNext(
			this.config.workerId,
			this.config.leaseDurationMilliseconds
		);
		if (claim === null) return null;
		try {
			return await runWithFullHistoryBackfillLease({
				leaseDurationMs: this.config.leaseDurationMilliseconds,
				renew: () =>
					this.repository.renewLease(
						claim,
						this.config.leaseDurationMilliseconds
					),
				work: (leaseSignal, terminal) =>
					this.bindClaim(
						claim,
						AbortSignal.any([signal, leaseSignal]),
						terminal
					)
			});
		} catch (error) {
			const failure = asError(error);
			await this.repository.fail(claim, failure);
			throw failure;
		}
	}

	private async bindClaim(
		claim: FullHistoryStateCanonicalCoverageClaim,
		signal: AbortSignal,
		terminal: FullHistoryBackfillLeaseTerminal
	): Promise<FullHistoryStateCanonicalCoverageReceipt> {
		const inputPath = await verifiedFullHistoryDatasetPath(
			this.config.storageRoot,
			claim.storageKey,
			claim.ledgerSourceSha256,
			signal
		);
		const rows: FullHistoryLedgerProjection[] = [];
		let nextLedger = claim.startLedger;
		let observedRows = 0n;
		const consumeRow = async (
			row: FullHistoryLedgerProjection
		): Promise<void> => {
			observedRows += 1n;
			if (observedRows > BigInt(claim.expectedLedgerCount)) {
				throw new Error('Ledger exporter exceeded its manifest record count');
			}
			if (BigInt(row.ledgerSequence) !== BigInt(nextLedger)) {
				throw new Error('Ledger exporter sequence is not contiguous');
			}
			nextLedger += 1;
			rows.push(row);
			if (rows.length >= this.config.insertBatchSize) {
				await this.repository.storeLedgerRows(claim, rows.splice(0));
			}
		};
		const exportResult = await this.exporter.export({
			consumeRow,
			expectedSourceSha256: claim.ledgerSourceSha256,
			inputPath,
			signal
		});
		if (exportResult.sourceSha256 !== claim.ledgerSourceSha256) {
			throw new Error(
				'Ledger exporter source digest does not match its manifest'
			);
		}
		const exportedRows = exportResult.recordCount;
		if (rows.length > 0) await this.repository.storeLedgerRows(claim, rows);
		if (
			exportedRows !== observedRows ||
			exportedRows !== BigInt(claim.expectedLedgerCount) ||
			nextLedger !== claim.endLedger + 1
		) {
			throw new Error('Ledger exporter range does not match its manifest');
		}
		return terminal.run(() => this.repository.complete(claim, exportedRows));
	}
}

function asError(error: unknown): Error {
	return error instanceof Error
		? error
		: new Error('Canonical state coverage failed', { cause: error });
}

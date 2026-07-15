import type { FullHistoryLedgerCloseMetaSha256Digest } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type {
	FullHistoryAccountStateChange,
	FullHistoryStateChange,
	FullHistoryTrustlineStateChange
} from '../../domain/full-history-state-import/FullHistoryStateExport.js';
import type {
	FullHistoryStateImportClaim,
	FullHistoryStateImportReceipt,
	FullHistoryStateImportRepository
} from '../../domain/full-history-state-import/FullHistoryStateImport.js';
import {
	FullHistoryStateRowSetHasher,
	type FullHistoryStateRowEvidence
} from '../../domain/full-history-state-import/FullHistoryStateRowEvidence.js';
import {
	runWithFullHistoryBackfillLease,
	type FullHistoryBackfillLeaseTerminal
} from '../run-full-history-backfill/FullHistoryBackfillLeaseKeeper.js';
import { verifiedFullHistoryDatasetPath } from '../full-history-dataset/VerifiedFullHistoryDatasetPath.js';

export interface FullHistoryStateExporter {
	export(input: {
		readonly claim: FullHistoryStateImportClaim;
		readonly consumeRow: (row: FullHistoryStateChange) => Promise<void>;
		readonly inputPath: string;
		readonly signal: AbortSignal;
	}): Promise<{
		readonly recordCount: bigint;
		readonly sourceSha256: FullHistoryLedgerCloseMetaSha256Digest;
	}>;
}

export interface ImportNextFullHistoryStateDatasetConfig {
	readonly insertBatchSize: number;
	readonly leaseDurationMilliseconds: number;
	readonly storageRoot: string;
	readonly workerId: string;
}

export class ImportNextFullHistoryStateDataset {
	constructor(
		private readonly repository: FullHistoryStateImportRepository,
		private readonly exporter: FullHistoryStateExporter,
		private readonly config: ImportNextFullHistoryStateDatasetConfig
	) {
		if (
			!Number.isInteger(config.insertBatchSize) ||
			config.insertBatchSize < 1 ||
			config.insertBatchSize > 500
		) {
			throw new TypeError('State import insert batch size must be 1 to 500');
		}
	}

	async execute(
		signal: AbortSignal
	): Promise<FullHistoryStateImportReceipt | null> {
		await this.repository.registerPendingImports();
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
					this.importClaim(
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

	private async importClaim(
		claim: FullHistoryStateImportClaim,
		signal: AbortSignal,
		terminal: FullHistoryBackfillLeaseTerminal
	): Promise<FullHistoryStateImportReceipt> {
		const inputPath = await verifiedFullHistoryDatasetPath(
			this.config.storageRoot,
			claim.storageKey,
			claim.sourceSha256,
			signal
		);
		const accounts: FullHistoryStateRowEvidence<FullHistoryAccountStateChange>[] =
			[];
		const trustlines: FullHistoryStateRowEvidence<FullHistoryTrustlineStateChange>[] =
			[];
		const rowSetHasher = new FullHistoryStateRowSetHasher();
		let observedRows = 0n;
		const consumeRow = async (row: FullHistoryStateChange): Promise<void> => {
			observedRows += 1n;
			if (observedRows > claim.expectedRecordCount) {
				throw new Error('State exporter exceeded its manifest record count');
			}
			if (claim.dataset === 'account-state-changes') {
				if (!isAccountStateChange(row)) {
					throw new TypeError('Account state import received a trustline row');
				}
				accounts.push(rowSetHasher.append(row));
				if (accounts.length >= this.config.insertBatchSize) {
					await this.repository.storeAccountRows(claim, accounts.splice(0));
				}
				return;
			}
			if (!isTrustlineStateChange(row)) {
				throw new TypeError('Trustline state import received an account row');
			}
			trustlines.push(rowSetHasher.append(row));
			if (trustlines.length >= this.config.insertBatchSize) {
				await this.repository.storeTrustlineRows(claim, trustlines.splice(0));
			}
		};
		const exportResult = await this.exporter.export({
			claim,
			consumeRow,
			inputPath,
			signal
		});
		if (exportResult.sourceSha256 !== claim.sourceSha256) {
			throw new Error(
				'State exporter source digest does not match its manifest'
			);
		}
		const exportedRows = exportResult.recordCount;
		if (accounts.length > 0) {
			await this.repository.storeAccountRows(claim, accounts);
		}
		if (trustlines.length > 0) {
			await this.repository.storeTrustlineRows(claim, trustlines);
		}
		if (
			exportedRows !== observedRows ||
			exportedRows !== claim.expectedRecordCount
		) {
			throw new Error(
				'State exporter record count does not match its manifest'
			);
		}
		const rowSetSha256 = rowSetHasher.finish();
		await terminal.run(() =>
			this.repository.complete(claim, exportedRows, rowSetSha256)
		);
		return Object.freeze({
			batchId: claim.batchId,
			dataset: claim.dataset,
			recordCount: exportedRows,
			rowSetSha256
		});
	}
}

function isAccountStateChange(
	row: FullHistoryStateChange
): row is FullHistoryAccountStateChange {
	return 'signerCount' in row;
}

function isTrustlineStateChange(
	row: FullHistoryStateChange
): row is FullHistoryTrustlineStateChange {
	return 'assetType' in row;
}

function asError(error: unknown): Error {
	return error instanceof Error
		? error
		: new Error('Full-history state import failed', { cause: error });
}

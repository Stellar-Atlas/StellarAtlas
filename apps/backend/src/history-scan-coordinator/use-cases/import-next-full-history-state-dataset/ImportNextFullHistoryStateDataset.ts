import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryLedgerCloseMetaSha256Digest
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
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
import { runWithFullHistoryBackfillLease } from '../run-full-history-backfill/FullHistoryBackfillLeaseKeeper.js';

export interface FullHistoryStateExporter {
	export(input: {
		readonly claim: FullHistoryStateImportClaim;
		readonly consumeRow: (row: FullHistoryStateChange) => Promise<void>;
		readonly inputPath: string;
		readonly signal: AbortSignal;
	}): Promise<bigint>;
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
				work: () => this.importClaim(claim, signal)
			});
		} catch (error) {
			const failure = asError(error);
			await this.repository.fail(claim, failure);
			throw failure;
		}
	}

	private async importClaim(
		claim: FullHistoryStateImportClaim,
		signal: AbortSignal
	): Promise<FullHistoryStateImportReceipt> {
		const inputPath = await verifiedInputPath(
			this.config.storageRoot,
			claim.storageKey,
			claim.sourceSha256,
			signal
		);
		const accounts: FullHistoryAccountStateChange[] = [];
		const trustlines: FullHistoryTrustlineStateChange[] = [];
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
				accounts.push(row);
				if (accounts.length >= this.config.insertBatchSize) {
					await this.repository.storeAccountRows(claim, accounts.splice(0));
				}
				return;
			}
			if (!isTrustlineStateChange(row)) {
				throw new TypeError('Trustline state import received an account row');
			}
			trustlines.push(row);
			if (trustlines.length >= this.config.insertBatchSize) {
				await this.repository.storeTrustlineRows(claim, trustlines.splice(0));
			}
		};
		const exportedRows = await this.exporter.export({
			claim,
			consumeRow,
			inputPath,
			signal
		});
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
		await this.repository.complete(claim, exportedRows);
		return Object.freeze({
			batchId: claim.batchId,
			dataset: claim.dataset,
			recordCount: exportedRows
		});
	}
}

async function verifiedInputPath(
	storageRoot: string,
	storageKey: string,
	expectedDigest: FullHistoryLedgerCloseMetaSha256Digest,
	signal: AbortSignal
): Promise<string> {
	if (signal.aborted) throw asError(signal.reason);
	const root = await realpath(storageRoot);
	const candidate = resolve(root, storageKey);
	if (!candidate.startsWith(`${root}${sep}`)) {
		throw new TypeError('State import path escapes its storage root');
	}
	const actual = await realpath(candidate);
	if (!actual.startsWith(`${root}${sep}`)) {
		throw new TypeError('State import file resolves outside its storage root');
	}
	const info = await stat(actual);
	if (!info.isFile()) throw new TypeError('State import source is not a file');
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(actual, { signal }))
		hash.update(chunk);
	const digest = fullHistoryLedgerCloseMetaSha256Digest(hash.digest('hex'));
	if (digest !== expectedDigest) {
		throw new Error('State import source digest does not match its manifest');
	}
	return actual;
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

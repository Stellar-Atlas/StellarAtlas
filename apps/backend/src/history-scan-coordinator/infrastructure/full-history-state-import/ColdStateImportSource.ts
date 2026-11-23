import { hash as stellarProtocolHash } from '@stellar/stellar-sdk';
import { lstat, realpath } from 'node:fs/promises';
import {
	basename,
	dirname,
	isAbsolute,
	normalize,
	resolve,
	sep
} from 'node:path';
import type { DataSource } from 'typeorm';
import {
	historyColdReader,
	type HistoryColdReader
} from '../../../status/infrastructure/http/HistoryDataColdDownload.js';
import type { ColdStateImportSource } from '../../use-cases/import-next-full-history-state-dataset/ImportNextFullHistoryStateDataset.js';

// A missing projection is recoverable from the normal committed batch, not
// from a list of files someone previously removed. Import ownership is unchanged.
export function coldStateImportSource(
	db: DataSource,
	root: string,
	env: NodeJS.ProcessEnv
): ColdStateImportSource | undefined {
	const network =
		env.FULL_HISTORY_NETWORK_PASSPHRASE ?? env.NETWORK_PASSPHRASE ?? '';
	const reader = historyColdReader(env, network, root);
	if (!reader) return undefined;
	if (!network || process.platform !== 'linux')
		throw new Error(
			'Cold state import requires the configured Stellar network and Linux file descriptors'
		);
	return bindColdStateImport(
		db,
		root,
		Buffer.from(stellarProtocolHash(Buffer.from(network))),
		reader
	);
}

export function bindColdStateImport(
	db: Pick<DataSource, 'query'>,
	root: string,
	network: Buffer,
	reader: HistoryColdReader
): ColdStateImportSource {
	return async (claim, signal) => {
		signal.throwIfAborted();
		const parent = await realpath(root);
		const original = resolve(parent, claim.storageKey);
		if (
			isAbsolute(claim.storageKey) ||
			normalize(claim.storageKey) !== claim.storageKey ||
			!original.startsWith(parent + sep) ||
			basename(original) !== claim.dataset + '.parquet' ||
			(await realpath(dirname(original))) !== dirname(original)
		)
			throw new Error('Unsafe state source path');
		// Reject dangling links, a missing mount/directory, or a path reappearing
		// during the hot read. A subsequent normal attempt can use a restored file.
		try {
			await lstat(original);
			throw new Error('State source is present; cold fallback refused');
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
		}
		const rows = await db.query<
			{
				manifestSha256: string;
				canonicalSha256: string;
				canonicalKey: string;
				canonicalBytes: string;
				byteCount: string;
				outputSha256: string;
				recordCount: string;
				storageKey: string;
				startLedger: string;
				endLedger: string;
			}[]
		>(
			`select encode(b.processing_manifest_sha256,'hex') as "manifestSha256",
			b.start_ledger::text as "startLedger", b.end_ledger::text as "endLedger",
			encode(d.output_sha256,'hex') as "outputSha256", d.storage_key as "storageKey",
			d.output_bytes::text as "byteCount", d.record_count::text as "recordCount",
			encode(c.output_sha256,'hex') as "canonicalSha256", c.storage_key as "canonicalKey",
			c.output_bytes::text as "canonicalBytes"
			from full_history_ledger_close_meta_batch b
			join full_history_ledger_close_meta_dataset d on d.batch_id=b.id and d.network_passphrase_hash=b.network_passphrase_hash
			join full_history_ledger_close_meta_dataset c on c.batch_id=b.id and c.network_passphrase_hash=b.network_passphrase_hash
			where b.network_passphrase_hash=$1 and b.id=$2::uuid and b.processed_at is not null
			and d.dataset=$3 and d.schema_version=$4 and d.media_type='application/vnd.apache.parquet' and d.representation='typed-projection'
			and c.dataset='ledger-close-meta' and c.schema_version='stellar-atlas.full-history.ledger-close-meta-batch.v1'
			and c.representation='lossless-replay' and c.record_count=b.ledger_count`,
			[
				network,
				claim.batchId,
				claim.dataset,
				'stellar-atlas.full-history.' + claim.dataset + '.v1'
			]
		);
		const row = rows[0];
		if (
			rows.length !== 1 ||
			!row ||
			row.startLedger !== String(claim.startLedger) ||
			row.endLedger !== String(claim.endLedger) ||
			row.storageKey !== claim.storageKey ||
			row.outputSha256 !== claim.sourceSha256 ||
			row.recordCount !== claim.expectedRecordCount.toString() ||
			!/^[1-9]\d*$/.test(row.byteCount) ||
			!/^[1-9]\d*$/.test(row.canonicalBytes) ||
			!/^[0-9a-f]{64}$/.test(row.manifestSha256) ||
			!/^[0-9a-f]{64}$/.test(row.canonicalSha256)
		)
			throw new Error('No matching committed dataset for this state import');
		const canonical = resolve(parent, row.canonicalKey);
		if (
			isAbsolute(row.canonicalKey) ||
			normalize(row.canonicalKey) !== row.canonicalKey ||
			dirname(canonical) !== dirname(original) ||
			basename(canonical) !== 'ledger-close-meta.xdr.zst'
		)
			throw new Error('Invalid retained canonical state source');
		const plan = {
			batchId: claim.batchId,
			manifestSha256: row.manifestSha256,
			canonicalSha256: row.canonicalSha256
		};
		const output = {
			dataset: claim.dataset,
			storageKey: row.storageKey,
			byteCount: row.byteCount,
			outputSha256: row.outputSha256
		};
		if (!reader.supports(output))
			throw new Error(
				'State output cannot be materialized within the configured cache'
			);
		signal.throwIfAborted();
		const lease = await reader.acquire(plan, output, async () => ({
			path: resolve(root, row.canonicalKey),
			byteCount: row.canonicalBytes
		}));
		return { fd: lease.handle.fd, release: () => lease.release() };
	};
}

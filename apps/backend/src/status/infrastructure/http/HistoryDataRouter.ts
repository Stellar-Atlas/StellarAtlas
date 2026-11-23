import { readDerivedOutputRetirements, RETIRABLE_DERIVED_DATASETS, type DerivedOutputRecovery } from '@history-scan-coordinator/infrastructure/full-history-ledger-close-meta/FullHistoryDerivedOutputRetirement.js';
import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import type { DataSource } from 'typeorm';
import { hashNetworkPassphrase } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import {
	FULL_HISTORY_LEDGER_CLOSE_META_DATASETS,
	type FullHistoryLedgerCloseMetaDataset
} from '@history-scan-coordinator/domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';
import { readFullHistoryLedgerCloseMetaCoverage } from '../../use-cases/get-full-history-status/FullHistoryLedgerCloseMetaCoverage.js';
import { checkedHistoryStorageRoot, serveColdHistoryDownload, serveHistoryDescriptor, type HistoryColdReader } from './HistoryDataColdDownload.js';

export interface HistoryDataRouterConfig {
	readonly dataSource: DataSource;
	readonly networkPassphrase: string;
	readonly storageRoot: string;
	readonly coldReader?: HistoryColdReader;
}

interface BatchDatasetRow {
	readonly batchId: string;
	readonly byteCount: number | string;
	readonly dataset: string;
	readonly endLedger: number | string;
	readonly ledgerCount: number | string;
	readonly mediaType: string;
	readonly processedAt: Date | string;
	readonly recordCount: number | string;
	readonly representation: string;
	readonly schemaVersion: string;
	readonly sha256: Buffer;
	readonly startLedger: number | string;
}

interface DownloadRow {
	readonly byteCount: number | string;
	readonly mediaType: string;
	readonly sha256: Buffer;
	readonly storageKey: string;
}

interface MutableBatch {
	readonly batchId: string;
	readonly endLedger: string;
	readonly ledgerCount: number;
	readonly outputs: Array<{
		readonly byteCount: string;
		readonly dataset: FullHistoryLedgerCloseMetaDataset;
		readonly downloadPath: string | null;
		readonly availability: 'retained' | 'retired' | 'on-demand';
		readonly replacementPath: string | null;
		readonly mediaType: string;
		readonly recordCount: string;
		readonly representation: string;
		readonly schemaVersion: string;
		readonly sha256: string;
	}>;
	readonly processedAt: string;
	readonly startLedger: string;
}

const datasetNames = new Set<string>(FULL_HISTORY_LEDGER_CLOSE_META_DATASETS);
const batchIdPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaultLimit = 25;
const maximumLimit = 100;
const publicNetworkPassphrase =
	'Public Global Stellar Network ; September 2015';
const publicNetworkGenesisLedgerHash =
	'39c2a3cd4141b2853e70d84601faa44744660334b48f3228e0309342e3f4eb48';
const publicNetworkLedgerTwoHash =
	'fe0f6bea5f341344fdb5bc6fc4ad719dd63071d9203e9a1e7f17c68ea1ecebde';

export const HistoryDataRouterWrapper = (
	config: HistoryDataRouterConfig
): Router => {
	const router = express.Router();
	const networkHash = hashNetworkPassphrase(
		config.networkPassphrase
	).toBuffer();
	const storageRoot = checkedHistoryStorageRoot(resolve(config.storageRoot));

	router.get('/catalog', async (_req, res) => {
		try {
			const coverage = await readFullHistoryLedgerCloseMetaCoverage(
				config.dataSource,
				config.networkPassphrase
			);
			return res
				.status(200)
				.setHeader('Cache-Control', 'public, max-age=10')
				.json({
					batchListPath: '/v1/history-data/batches',
					coverage,
					format: 'stellar-atlas-decoded-history-v1',
					historyOrigin: historyOrigin(config.networkPassphrase),
					galexie: {
						compatible: false,
						endpoint: '/galexie/.config.json',
						explanation:
							'Typed 1024-ledger projections are derived from SEP-54 LedgerCloseMeta but are not SEP-54 object geometry.'
					},
					generatedAt: new Date().toISOString(),
					networkPassphrase: config.networkPassphrase,
					sourceFormat: 'SEP-54 LedgerCloseMeta',
					storage: 'immutable-provenance-with-explicit-retirement',
					byteCountMeaning: 'Historical produced bytes; batch output availability reports retained downloads'
				});
		} catch {
			return res
				.status(500)
				.json({ error: 'History data catalog is unavailable' });
		}
	});

	router.get('/batches', async (req, res) => {
		const dataset = parseDataset(req.query.dataset);
		const limit = parseLimit(req.query.limit);
		const beforeLedger = parseOptionalLedger(req.query.beforeLedger);
		if (dataset === undefined || limit === null || beforeLedger === undefined) {
			return res.status(400).json({ error: 'Invalid history data query' });
		}

		try {
			const rows = await config.dataSource.query<BatchDatasetRow[]>(
				batchListSql,
				[networkHash, beforeLedger, limit, dataset]
			);
			const retirements = await readDerivedOutputRetirements(config.dataSource, networkHash, {
				batchIds: [...new Set(rows.map(row => row.batchId))]
			});
			const batches = mapBatchRows(rows, retirements, config.coldReader);
			return res
				.status(200)
				.setHeader('Cache-Control', 'public, max-age=10')
				.json({
					batches,
					dataset,
					generatedAt: new Date().toISOString(),
					limit,
					nextBeforeLedger:
						batches.length === limit
							? (batches.at(-1)?.startLedger ?? null)
							: null
				});
		} catch {
			return res
				.status(500)
				.json({ error: 'History data batches are unavailable' });
		}
	});

	router.get('/batches/:batchId/:dataset', rateLimit({
		windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false
	}), async (req, res) => {
		const dataset = parseDataset(req.params.dataset);
		if (
			dataset === undefined ||
			dataset === null ||
			!batchIdPattern.test(req.params.batchId)
		) {
			return res.status(400).json({ error: 'Invalid history data artifact' });
		}

		try {
			const rows = await config.dataSource.query<DownloadRow[]>(downloadSql, [
				networkHash,
				req.params.batchId,
				dataset
			]);
			const artifact = rows[0];
			if (artifact === undefined) {
				return res
					.status(404)
					.json({ error: 'History data artifact not found' });
			}
			const readPlan = async () => (await readDerivedOutputRetirements(config.dataSource, networkHash, {
				batchIds: [req.params.batchId]
			}))[0];
			let plan = await readPlan();
			let retirement = plan?.outputs.find(output => output.dataset === dataset);
			if (!retirement) {
				const filePath = resolveArtifactPath(storageRoot, artifact.storageKey);
				if (filePath === null) return res.status(500).json({ error: 'History data artifact path is invalid' });
				let file: FileHandle | undefined;
				try {
					file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
				} catch (error) {
					// Authority is committed before unlink. If a hot name disappeared since
					// our snapshot, re-read only this batch once; unexplained absence is never cold authority.
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT' ||
						!RETIRABLE_DERIVED_DATASETS.some(name => name === dataset)) throw error;
					plan = await readPlan();
					retirement = plan?.outputs.find(output => output.dataset === dataset);
					if (!retirement) throw error;
				}
				if (file) {
					try {
						const st = await file.stat({ bigint: true });
						const byteCount = unsignedString(artifact.byteCount, 'byteCount');
						if (!st.isFile() || st.size.toString() !== byteCount) throw new Error('Retained file size mismatch');
						const fd = file;
						return await serveHistoryDescriptor(req, res, { byteCount, sha256: digest(artifact.sha256),
							filename: safeFilename(basename(filePath)), mediaType: artifact.mediaType, modified: st.mtime },
							async () => ({ handle: fd, release: async () => {} }));
					} finally { await file.close(); }
				}
			}
			if (plan && retirement) {
				if (retirement.outputSha256 !== digest(artifact.sha256) ||
					retirement.byteCount !== unsignedString(artifact.byteCount, 'byteCount') ||
					retirement.storageKey !== artifact.storageKey) throw new Error('Retirement descriptor mismatch');
				const selectedPlan = plan;
				if (config.coldReader?.supports(retirement)) {
					return await serveColdHistoryDownload(req, res, plan, retirement, artifact.mediaType,
						config.coldReader, async () => {
							const [canonical] = await config.dataSource.query<DownloadRow[]>(downloadSql,
								[networkHash, selectedPlan.batchId, 'ledger-close-meta']);
							if (!canonical || digest(canonical.sha256) !== selectedPlan.canonicalSha256)
								throw new Error('Canonical descriptor unavailable');
							const path = resolveArtifactPath(storageRoot, canonical.storageKey);
							if (!path) throw new Error('Invalid canonical artifact');
							return { path, byteCount: unsignedString(canonical.byteCount, 'byteCount') };
						});
				}
				return res.status(410).setHeader('Cache-Control', 'no-store').json({
					error: 'This derived export has been retired',
					replacementPath: '/v1/history-data/batches/' + req.params.batchId + '/ledger-close-meta',
					explanation: 'The canonical replay remains available. A regenerated projection is a new export, not the historical compressed bytes.'
				});
			}
			throw new Error('History data artifact unavailable');
		} catch {
			if (res.headersSent) return res.end();
			for (const header of ['Content-Length', 'Content-Disposition', 'Content-Type', 'Content-Range',
				'Accept-Ranges', 'ETag', 'Last-Modified', 'X-Content-SHA256', 'X-Atlas-Artifact-Source']) res.removeHeader(header);
			return res
				.status(503)
				.setHeader('Cache-Control', 'no-store')
				.json({ error: 'History data artifact is unavailable' });
		}
	});

	return router;
};

function mapBatchRows(
	rows: readonly BatchDatasetRow[], retirements: readonly DerivedOutputRecovery[], cold?: HistoryColdReader
): readonly MutableBatch[] {
	const batches = new Map<string, MutableBatch>();
	for (const row of rows) {
		const dataset = requireDataset(row.dataset);
		let batch = batches.get(row.batchId);
		if (batch === undefined) {
			batch = {
				batchId: row.batchId,
				endLedger: unsignedString(row.endLedger, 'endLedger'),
				ledgerCount: safeInteger(row.ledgerCount, 'ledgerCount'),
				outputs: [],
				processedAt: dateValue(row.processedAt).toISOString(),
				startLedger: unsignedString(row.startLedger, 'startLedger')
			};
			batches.set(row.batchId, batch);
		}
		const retired = retirements.find(plan => plan.batchId === row.batchId)?.outputs
			.find(output => output.dataset === dataset);
		if (retired && (retired.outputSha256 !== digest(row.sha256) ||
			retired.byteCount !== unsignedString(row.byteCount, 'byteCount'))) throw new Error('Retirement descriptor mismatch');
		const onDemand = retired && cold?.supports(retired);
		batch.outputs.push({
			byteCount: unsignedString(row.byteCount, 'byteCount'),
			dataset,
			availability: onDemand ? 'on-demand' : retired ? 'retired' : 'retained',
			replacementPath: retired ? '/v1/history-data/batches/' + row.batchId + '/ledger-close-meta' : null,
			downloadPath: retired && !onDemand ? null :
				'/v1/history-data/batches/' +
				encodeURIComponent(row.batchId) +
				'/' +
				encodeURIComponent(dataset),
			mediaType: row.mediaType,
			recordCount: unsignedString(row.recordCount, 'recordCount'),
			representation: row.representation,
			schemaVersion: row.schemaVersion,
			sha256: digest(row.sha256)
		});
	}
	return Object.freeze([...batches.values()]);
}

function parseDataset(
	value: unknown
): FullHistoryLedgerCloseMetaDataset | null | undefined {
	if (value === undefined) return null;
	if (typeof value !== 'string' || !datasetNames.has(value)) return undefined;
	return value as FullHistoryLedgerCloseMetaDataset;
}

function requireDataset(value: string): FullHistoryLedgerCloseMetaDataset {
	if (!datasetNames.has(value)) {
		throw new TypeError('Unknown full-history dataset');
	}
	return value as FullHistoryLedgerCloseMetaDataset;
}

function parseLimit(value: unknown): number | null {
	if (value === undefined) return defaultLimit;
	if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return null;
	const limit = Number(value);
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumLimit) {
		return null;
	}
	return limit;
}

function parseOptionalLedger(value: unknown): string | null | undefined {
	if (value === undefined) return null;
	if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
		return undefined;
	}
	const ledger = BigInt(value);
	return ledger <= 4_294_967_295n ? ledger.toString() : undefined;
}
function historyOrigin(networkPassphrase: string) {
	if (networkPassphrase !== publicNetworkPassphrase) return null;
	return Object.freeze({
		explanation:
			'Pubnet ledger 1 is the synthetic genesis ledger header and has no LedgerCloseMeta transition. Ledger 2 is the first LedgerCloseMeta; it contains zero transactions and links to genesis through previousLedgerHash.',
		firstLedgerCloseMeta: Object.freeze({
			hash: publicNetworkLedgerTwoHash,
			previousLedgerHash: publicNetworkGenesisLedgerHash,
			sequence: '2',
			transactionCount: 0
		}),
		genesis: Object.freeze({
			hash: publicNetworkGenesisLedgerHash,
			ledgerCloseMetaAvailable: false,
			sequence: '1'
		})
	});
}

function resolveArtifactPath(root: string, storageKey: string): string | null {
	if (storageKey.includes('\\')) return null;
	const filePath = resolve(root, storageKey);
	if (filePath !== root && !filePath.startsWith(root + sep)) return null;
	return filePath;
}

function safeFilename(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function unsignedString(value: number | string, field: string): string {
	const parsed = BigInt(value);
	if (parsed < 0n) throw new TypeError(field + ' is invalid');
	return parsed.toString();
}

function safeInteger(value: number | string, field: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new TypeError(field + ' is invalid');
	}
	return parsed;
}

function dateValue(value: Date | string): Date {
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.valueOf())) {
		throw new TypeError('processedAt is invalid');
	}
	return date;
}

function digest(value: Buffer): string {
	if (!Buffer.isBuffer(value) || value.byteLength !== 32) {
		throw new TypeError('Artifact digest is invalid');
	}
	return value.toString('hex');
}

const batchListSql = [
	'with selected_batch as (',
	' select batch."id", batch."start_ledger", batch."end_ledger",',
	'  batch."ledger_count", batch."processed_at"',
	' from "full_history_ledger_close_meta_batch" batch',
	' where batch."network_passphrase_hash" = $1',
	'  and ($2::bigint is null or batch."start_ledger" < $2)',
	' order by batch."end_ledger" desc',
	' limit $3',
	')',
	'select selected."id" as "batchId",',
	' selected."start_ledger"::text as "startLedger",',
	' selected."end_ledger"::text as "endLedger",',
	' selected."ledger_count" as "ledgerCount",',
	' selected."processed_at" as "processedAt",',
	'dataset."dataset", dataset."media_type" as "mediaType",',
	'dataset."representation", dataset."schema_version" as "schemaVersion",',
	'dataset."record_count"::text as "recordCount",',
	'dataset."output_bytes"::text as "byteCount",',
	'dataset."output_sha256" as "sha256"',
	'from selected_batch selected',
	'join "full_history_ledger_close_meta_dataset" dataset',
	' on dataset."batch_id" = selected."id"',
	'where ($4::text is null or dataset."dataset" = $4)',
	'order by selected."end_ledger" desc, dataset."dataset"'
].join(' ');

const downloadSql = [
	'select dataset."media_type" as "mediaType",',
	' dataset."output_bytes"::text as "byteCount",',
	' dataset."output_sha256" as "sha256",',
	' dataset."storage_key" as "storageKey"',
	'from "full_history_ledger_close_meta_dataset" dataset',
	'where dataset."network_passphrase_hash" = $1',
	' and dataset."batch_id" = $2::uuid',
	' and dataset."dataset" = $3'
].join(' ');

export { HistoryDataRouterWrapper as historyDataRouter };

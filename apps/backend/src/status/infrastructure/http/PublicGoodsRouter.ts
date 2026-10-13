import express, { type Response, type Router } from 'express';
import type { HistoryArchiveStatusSummaryV1 } from 'shared';
import type {
	PublicGoodsCheckStatusV1,
	PublicGoodsHealthV1,
	PublicGoodsMetricsV1
} from 'shared';
import type { GetHistoryArchiveObjectStatusSummary } from '@history-scan-coordinator/use-cases/get-history-archive-object-status-summary/GetHistoryArchiveObjectStatusSummary.js';
import type {
	HubbleCatalog,
	HubbleWarehouse
} from './HubbleWarehouseContracts.js';

const measurementFreshnessMs = 60_000;
const publicationFreshnessMs = 24 * 60 * 60 * 1000;
const checkedRootWindowMs = 24 * 60 * 60 * 1000;
const sourceCacheMs = 45_000;
const failedSourceCacheMs = 5_000;
const futureClockSkewMs = 5_000;

export interface PublicGoodsRouterConfig {
	readonly warehouse: HubbleWarehouse;
	readonly getArchiveStatusSummary: Pick<
		GetHistoryArchiveObjectStatusSummary,
		'execute'
	>;
}

export function publicGoodsRouter(config: PublicGoodsRouterConfig): Router {
	const router = express.Router();
	const readSnapshot = createSnapshotReader(config);

	router.get('/health', async (_request, response) => {
		const generatedAt = new Date().toISOString();
		const checks = await readChecks(config, generatedAt, readSnapshot);
		const ready = Object.values(checks).every(
			(check) => check.status === 'ready'
		);
		const body: PublicGoodsHealthV1 = {
			generatedAt,
			status: ready ? 'ready' : 'not_ready',
			checks
		};
		sendNoCacheJson(response, ready ? 200 : 503, body);
	});

	router.get('/metrics', async (_request, response) => {
		const generatedAt = new Date().toISOString();
		const { catalog, archiveSummary } = await readSnapshot();
		const archiveComplete =
			archiveSummary !== null &&
			!archiveSummary.sourcesTruncated &&
			archiveSummary.sourceCount === archiveSummary.sources.length;
		const sources = archiveSummary?.sources ?? [];
		const checked = sources.filter((source) =>
			isRecentTimestamp(source.observedAt, generatedAt)
		);
		const verifiedRootObjects = sources.filter(
			(source) => source.rootObjectStatus === 'verified'
		);
		const evidenceTimes = sources
			.map((source) => source.observedAt)
			.filter(isTimestamp)
			.sort();
		const body: PublicGoodsMetricsV1 = {
			generatedAt,
			publication: mapPublicationMetrics(catalog),
			archives: {
				observedAt: archiveSummary?.generatedAt ?? null,
				knownRoots: archiveSummary?.sourceCount ?? null,
				checkedRoots: archiveComplete ? checked.length : null,
				checkedRootWindowHours: 24,
				rootObjectsVerified: archiveComplete
					? verifiedRootObjects.length
					: null,
				rootObjectsFailed: archiveComplete
					? sources.filter((source) => source.rootObjectStatus === 'failed')
							.length
					: null,
				oldestEvidenceAt: archiveComplete ? (evidenceTimes[0] ?? null) : null,
				newestEvidenceAt: archiveComplete
					? (evidenceTimes.at(-1) ?? null)
					: null,
				complete: archiveComplete
			}
		};
		const available = catalog !== null && archiveSummary !== null;
		sendNoCacheJson(response, available ? 200 : 503, body);
	});

	return router;
}

interface PublicGoodsSnapshot {
	readonly catalog: HubbleCatalog | null;
	readonly archiveSummary: HistoryArchiveStatusSummaryV1 | null;
}

function createSnapshotReader(config: PublicGoodsRouterConfig) {
	let catalogCache: {
		readonly value: HubbleCatalog | null;
		readonly until: number;
	} | null = null;
	let catalogFlight: Promise<HubbleCatalog | null> | null = null;
	let archiveCache: {
		readonly value: HistoryArchiveStatusSummaryV1 | null;
		readonly until: number;
	} | null = null;
	let archiveFlight: Promise<HistoryArchiveStatusSummaryV1 | null> | null =
		null;

	const readCatalog = (): Promise<HubbleCatalog | null> => {
		if (catalogCache && catalogCache.until > Date.now()) {
			return Promise.resolve(catalogCache.value);
		}
		if (catalogFlight) return catalogFlight;
		catalogFlight = config.warehouse
			.catalog()
			.then((value) => {
				catalogCache = { value, until: Date.now() + sourceCacheMs };
				return value;
			})
			.catch(() => {
				catalogCache = { value: null, until: Date.now() + failedSourceCacheMs };
				return null;
			})
			.finally(() => {
				catalogFlight = null;
			});
		return catalogFlight;
	};

	const readArchive = (): Promise<HistoryArchiveStatusSummaryV1 | null> => {
		if (archiveCache && archiveCache.until > Date.now()) {
			return Promise.resolve(archiveCache.value);
		}
		if (archiveFlight) return archiveFlight;
		archiveFlight = config.getArchiveStatusSummary
			.execute()
			.then((result) => {
				if (result.isErr()) {
					archiveCache = {
						value: null,
						until: Date.now() + failedSourceCacheMs
					};
					return null;
				}
				const value = result.value;
				archiveCache = { value, until: Date.now() + sourceCacheMs };
				return value;
			})
			.catch(() => {
				archiveCache = { value: null, until: Date.now() + failedSourceCacheMs };
				return null;
			})
			.finally(() => {
				archiveFlight = null;
			});
		return archiveFlight;
	};

	return async (): Promise<PublicGoodsSnapshot> => {
		const [catalog, archiveSummary] = await Promise.all([
			readCatalog(),
			readArchive()
		]);
		return { catalog, archiveSummary };
	};
}

async function readChecks(
	config: PublicGoodsRouterConfig,
	generatedAt: string,
	readSnapshot: ReturnType<typeof createSnapshotReader>
): Promise<PublicGoodsHealthV1['checks']> {
	const [probeResult, snapshotResult] = await Promise.allSettled([
		config.warehouse.probe === undefined
			? Promise.reject(new Error('ClickHouse probe unavailable'))
			: config.warehouse.probe(),
		readSnapshot()
	]);
	const snapshot =
		snapshotResult.status === 'fulfilled'
			? snapshotResult.value
			: { catalog: null, archiveSummary: null };
	const catalog = snapshot.catalog;
	const summary = snapshot.archiveSummary;
	const manifestStatus = publicationReadiness(catalog, generatedAt);
	const catalogStatus = catalog
		? ageStatus(
				catalog.generatedAt,
				generatedAt,
				measurementFreshnessMs + 15_000
			)
		: 'unavailable';
	const publicationStatus: PublicGoodsCheckStatusV1 =
		manifestStatus !== 'ready' ? manifestStatus : catalogStatus;
	const archiveComplete =
		summary !== null &&
		!summary.sourcesTruncated &&
		summary.sourceCount === summary.sources.length &&
		summary.sourceCount > 0 &&
		summary.sources.every((source) => isTimestamp(source.observedAt));
	const recentRootCount =
		summary?.sources.filter((source) =>
			isRecentTimestamp(source.observedAt, generatedAt)
		).length ?? 0;
	const archiveMeasurementStatus = summary
		? ageStatus(summary.generatedAt, generatedAt)
		: 'unavailable';
	const archiveStatus: PublicGoodsCheckStatusV1 =
		summary === null
			? 'unavailable'
			: !archiveComplete
				? 'incomplete'
				: archiveMeasurementStatus !== 'ready'
					? archiveMeasurementStatus
					: recentRootCount === 0
						? 'stale'
						: 'ready';
	return {
		clickhouse: {
			status: probeResult.status === 'fulfilled' ? 'ready' : 'unavailable',
			observedAt: probeResult.status === 'fulfilled' ? generatedAt : null
		},
		publication: {
			status: publicationStatus,
			observedAt: catalog?.generatedAt ?? null,
			latestCompletedAt: catalog?.ingestion.latestCompletedAt ?? null
		},
		archive: {
			status: archiveStatus,
			observedAt: summary?.generatedAt ?? null,
			knownRoots: summary?.sourceCount ?? null,
			checkedRoots: archiveComplete ? recentRootCount : null,
			checkedRootWindowHours: 24,
			complete: archiveComplete
		}
	};
}

function publicationReadiness(
	catalog: HubbleCatalog | null,
	now: string
): PublicGoodsCheckStatusV1 {
	if (catalog === null) return 'unavailable';
	if (catalog.datasets.length === 0) return 'empty';
	if (
		!isPositiveInteger(catalog.ingestion.completedBatches) ||
		!isPositiveInteger(catalog.ingestion.totalRows)
	) {
		return 'empty';
	}
	const latest = catalog.ingestion.latestCompletedAt;
	if (latest === undefined || latest === null) return 'unavailable';
	return ageStatus(latest, now, publicationFreshnessMs);
}

function ageStatus(
	value: string,
	now: string,
	maximumAgeMs = measurementFreshnessMs
): PublicGoodsCheckStatusV1 {
	const observed = Date.parse(value);
	const current = Date.parse(now);
	if (!Number.isFinite(observed) || !Number.isFinite(current)) {
		return 'unavailable';
	}
	const age = current - observed;
	if (age < -futureClockSkewMs) return 'unavailable';
	return age <= maximumAgeMs ? 'ready' : 'stale';
}

function mapPublicationMetrics(catalog: HubbleCatalog | null) {
	return {
		observedAt: catalog?.generatedAt ?? null,
		configuredDatasets: catalog?.datasets.length ?? null,
		// A published dataset is API-configured with nonzero active part rows; this is not full-history proof.
		publishedDatasets:
			catalog?.datasets.filter((dataset) => isPositiveInteger(dataset.rowCount))
				.length ?? null,
		completedBatches: catalog?.ingestion.completedBatches ?? null,
		failedBatches: catalog?.ingestion.failedBatches ?? null,
		startedBatches: catalog?.ingestion.startedBatches ?? null,
		records: catalog?.ingestion.totalRows ?? null,
		latestCompletedAt: catalog?.ingestion.latestCompletedAt ?? null,
		maximumLedger: catalog?.ingestion.maximumLedger ?? null
	};
}

function isPositiveInteger(value: string): boolean {
	return /^\d+$/.test(value) && BigInt(value) > 0n;
}

function isTimestamp(value: string): boolean {
	return Number.isFinite(Date.parse(value));
}

function isRecentTimestamp(value: string, now: string): boolean {
	const observed = Date.parse(value);
	const current = Date.parse(now);
	return (
		Number.isFinite(observed) &&
		Number.isFinite(current) &&
		current - observed >= -futureClockSkewMs &&
		current - observed <= checkedRootWindowMs
	);
}

function sendNoCacheJson(
	response: Response,
	status: number,
	body: unknown
): void {
	response.statusCode = status;
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.setHeader(
		'Cache-Control',
		'no-store, no-cache, must-revalidate, proxy-revalidate'
	);
	response.setHeader('Pragma', 'no-cache');
	response.setHeader('Expires', '0');
	response.setHeader('Surrogate-Control', 'no-store');
	response.setHeader('CDN-Cache-Control', 'no-store');
	response.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
	response.end(JSON.stringify(body));
}

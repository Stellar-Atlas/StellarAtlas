import express from 'express';
import {
	archiveRadarHttpStatus,
	archiveRadarObjectUrl,
	isArchiveRadarResponse,
	publicArchiveRootIdentity,
	type ArchiveRadarResponse,
	type ArchiveRadarErrorCode
} from 'shared';
import {
	RadarHistoryArchiveScanSourceAdapter,
	type RadarHistoryArchiveScanFetch
} from '@cross-check/infrastructure/radar/RadarHistoryArchiveScanSourceAdapter.js';

/** Process-local, zero-waiter admission. No Atlas evidence/read-model work occurs here. */
export function archiveRadarObservationRouter(
	options: {
		readonly fetchFn?: RadarHistoryArchiveScanFetch;
		readonly now?: () => Date;
	} = {}
): express.Router {
	const router = express.Router(),
		now = options.now ?? (() => new Date());
	const adapter = new RadarHistoryArchiveScanSourceAdapter(
		options.fetchFn,
		now
	);
	const cache = new Map<
		string,
		{ dto: ArchiveRadarResponse; expires: number; bytes: number }
	>();
	let retainedBytes = 0,
		active = false;
	const remove = (key: string): void => {
		const item = cache.get(key);
		if (item) retainedBytes -= item.bytes;
		cache.delete(key);
	};
	const make = (
		root: string | null,
		status: ArchiveRadarResponse['status'],
		code: ArchiveRadarErrorCode | null,
		lookupAt: string | null = null
	): ArchiveRadarResponse => ({
		schemaVersion: 1,
		archiveUrl: root,
		source: 'withobsrvr-radar',
		status,
		errorCode: code,
		lookupAt,
		servedAt: now().toISOString(),
		cached: false,
		observation: null
	});
	const path = '/:encodedUrl/radar-observation';
	router.all(path, async (req, res) => {
		res.setHeader('Cache-Control', 'no-store');
		if (req.method !== 'GET') {
			res.setHeader('Allow', 'GET');
			res.status(405).end();
			return;
		}
		const raw = req.params.encodedUrl;
		const root =
			typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') <= 2048
				? publicArchiveRootIdentity(raw)
				: null;
		if (
			root === null ||
			Buffer.byteLength(root, 'utf8') > 2048 ||
			Object.keys(req.query).length !== 0
		) {
			res.status(400).json(make(null, 'invalid_request', 'invalid_request'));
			return;
		}
		for (const [key, item] of cache)
			if (item.expires <= now().getTime()) remove(key);
		const cached = cache.get(root);
		if (cached) {
			cache.delete(root);
			cache.set(root, cached);
			const dto = {
				...cached.dto,
				cached: true,
				servedAt: now().toISOString()
			};
			res.status(archiveRadarHttpStatus(dto)).json(dto);
			return;
		}
		if (active) {
			res.setHeader('Retry-After', '1');
			res.status(429).json(make(root, 'busy', 'busy'));
			return;
		}
		active = true;
		const controller = new AbortController();
		const cancel = (): void => {
			if (!res.writableEnded) controller.abort();
		};
		req.once('aborted', cancel);
		res.once('close', cancel);
		try {
			if (req.aborted || (res.destroyed && !res.writableEnded))
				controller.abort();
			if (controller.signal.aborted) return;
			const result = await adapter.fetchHistoryArchiveScan(root, {
				signal: controller.signal,
				timeoutMs: 5000,
				maxBytes: 100_000
			});
			if (
				controller.signal.aborted ||
				(result.isErr() && result.error.kind === 'cancelled')
			)
				return;
			const lookupAt = now().toISOString();
			let dto: ArchiveRadarResponse;
			if (result.isErr()) {
				const code: ArchiveRadarErrorCode =
					result.error.kind === 'timeout'
						? 'upstream_timeout'
						: result.error.kind === 'http_status'
							? 'upstream_http'
							: result.error.kind === 'network_error'
								? 'upstream_unavailable'
								: 'invalid_response';
				dto = make(root, 'unavailable', code, lookupAt);
			} else if (result.value === null)
				dto = make(root, 'not_found', null, lookupAt);
			else {
				const scan = result.value;
				dto = {
					...make(root, 'loaded', null, lookupAt),
					observation: {
						fetchedAt: scan.fetchedAt,
						contentHashSha256: scan.contentHashSha256,
						scanStartedAt: scan.startDate,
						scanEndedAt: scan.endDate,
						hasError: scan.hasError,
						errorObjectUrl: archiveRadarObjectUrl(scan.errorUrl, root),
						attribution: 'unclassified',
						checkpointScope: 'unknown',
						findingCoverage: 'unknown'
					}
				};
				if (!isArchiveRadarResponse(dto))
					dto = make(root, 'unavailable', 'invalid_response', lookupAt);
			}
			const bytes = Buffer.byteLength(JSON.stringify(dto), 'utf8');
			if (bytes <= 8192) {
				while (cache.size >= 32 || retainedBytes + bytes > 262_144) {
					const oldest = cache.keys().next().value;
					if (oldest === undefined) break;
					remove(oldest);
				}
				cache.set(root, {
					dto,
					bytes,
					expires:
						now().getTime() + (dto.status === 'unavailable' ? 5000 : 30_000)
				});
				retainedBytes += bytes;
			}
			res.status(archiveRadarHttpStatus(dto)).json(dto);
		} finally {
			req.off('aborted', cancel);
			res.off('close', cancel);
			active = false;
		}
	});
	return router;
}

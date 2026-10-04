import type { HttpService } from 'http-helper';
import { probeArchiveListingGap } from '../../domain/history-archive/ArchiveListingGapProbe.js';
import { archiveListingFetch } from '../../domain/history-archive/ArchiveListingHttpAdapter.js';
import type {
	HistoryArchiveObjectJobDTO,
	HistoryArchiveObjectFailureDTO
} from '../../domain/scan/ScanCoordinatorService.js';
import type { HistoryArchiveDownloadPermit } from '../../infrastructure/services/HistoryArchiveDownloadPermit.js';

/** Optional centrally leased discovery: a failure itself never proves a range. */
export async function discoverArchiveObjectListingGap(
	job: HistoryArchiveObjectJobDTO,
	failure: HistoryArchiveObjectFailureDTO,
	httpService: HttpService,
	downloadPermit: HistoryArchiveDownloadPermit
): Promise<HistoryArchiveObjectFailureDTO> {
	if (
		job.allowListingDiscovery !== true ||
		job.objectType !== 'checkpoint-state' ||
		(failure.httpStatus !== 404 && failure.httpStatus !== 410) ||
		job.checkpointLedger === null
	)
		return failure;
	const release = await downloadPermit.acquire();
	try {
		const listingGap = await probeArchiveListingGap(
			{
				archiveRoot: job.archiveUrl,
				checkpoint: job.checkpointLedger,
				failedObjectUrl: job.objectUrl,
				observedHttpStatus: failure.httpStatus
			},
			{ fetch: archiveListingFetch(httpService) }
		);
		return {
			...failure,
			...(listingGap === null ? {} : { listingGap }),
			listingCapability: {
				status: listingGap === null ? 'inconclusive' : 'supported',
				observedAt: new Date().toISOString()
			}
		};
	} finally {
		release();
	}
}

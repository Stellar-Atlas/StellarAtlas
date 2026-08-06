import type { ScanCoordinatorService } from '../../domain/scan/ScanCoordinatorService.js';
import type {
	HistoryArchiveObjectJobDelivery,
	HistoryArchiveObjectJobSource
} from '../../use-cases/verify-archive-objects/HistoryArchiveObjectJobDelivery.js';

export class RESTHistoryArchiveObjectJobSource
	implements HistoryArchiveObjectJobSource
{
	readonly kind = 'legacy-http' as const;

	constructor(private readonly coordinator: ScanCoordinatorService) {}

	async next(): Promise<HistoryArchiveObjectJobDelivery | null> {
		const result = await this.coordinator.getHistoryArchiveObjectJob();
		if (result.isErr()) throw result.error;
		if (result.value === null) return null;

		const job = result.value;
		return {
			acknowledge: async () => undefined,
			executionId: `${job.remoteId}:${job.claimAttempt}`,
			heartbeat: async () => {
				const heartbeat = await this.coordinator.touchHistoryArchiveObject(
					job.remoteId,
					{ claimAttempt: job.claimAttempt }
				);
				if (heartbeat.isErr()) throw heartbeat.error;
			},
			job,
			release: async () => {
				const released = await this.coordinator.releaseHistoryArchiveObject(
					job.remoteId,
					job.claimAttempt
				);
				if (released.isErr()) throw released.error;
			},
			retry: async () => {
				const released = await this.coordinator.releaseHistoryArchiveObject(
					job.remoteId,
					job.claimAttempt
				);
				if (released.isErr()) throw released.error;
			},
			source: 'legacy-http'
		};
	}

	async close(): Promise<void> {}
}

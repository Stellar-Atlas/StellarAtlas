import type { Logger } from 'logger';
import type { HistoryArchiveBrokerFrontierRepository } from '../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';

/** Probe authority remains in its own database transaction. Existing ready work
 * does not wait; an empty reservation joins this same task before retrying. */
export class ArchiveBrokerAdaptiveMaintenance {
	private pending: Promise<number> | null = null;
	private stopping = false;
	constructor(
		private readonly repository: Pick<
			HistoryArchiveBrokerFrontierRepository,
			'maintainAdaptiveProbes'
		>,
		private readonly logger: Pick<Logger, 'error'>,
		private readonly onCommittedAdmission: () => void
	) {}
	run(limit: number): Promise<number> {
		if (this.stopping) return Promise.resolve(0);
		if (this.pending !== null) return this.pending;
		this.pending = Promise.resolve()
			.then(() =>
				this.stopping ? 0 : this.repository.maintainAdaptiveProbes(limit)
			)
			.then((admitted) => {
				if (!this.stopping && admitted > 0) this.onCommittedAdmission();
				return admitted;
			})
			.catch((error: unknown) => {
				this.logger.error(
					'Archive broker optional adaptive maintenance failed',
					{
						errorMessage: error instanceof Error ? error.message : String(error)
					}
				);
				return 0;
			})
			.finally(() => {
				this.pending = null;
			});
		return this.pending;
	}
	async close(): Promise<void> {
		this.stopping = true;
		await this.pending;
	}
}

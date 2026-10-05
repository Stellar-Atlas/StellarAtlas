import type { Logger } from 'logger';
import type { HistoryArchiveBrokerFrontierRepository } from '../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';
import type { HistoryArchiveBrokerConfig } from './HistoryArchiveBrokerConfig.js';

/** Optional frontier work uses the existing pool and statement bounds. Periodic
 * callers do not wait; an empty ready queue joins the same sequence. */
export class ArchiveBrokerFrontierMaintenance {
	private pending: Promise<void> | null = null;
	private stopping = false;
	constructor(
		private readonly repository: Pick<
			HistoryArchiveBrokerFrontierRepository,
			'ensurePrefetch' | 'recoverMissingFrontierReady'
		>,
		private readonly config: Pick<
			HistoryArchiveBrokerConfig,
			'canonicalFirstRoot' | 'batchSize'
		>,
		private readonly logger: Pick<Logger, 'error'>,
		private readonly onComplete: () => void
	) {}
	run(): Promise<void> {
		if (this.stopping) return Promise.resolve();
		if (this.pending !== null) return this.pending;
		this.pending = Promise.resolve()
			.then(async () => {
				if (this.stopping) return;
				await this.repository.ensurePrefetch(this.config.canonicalFirstRoot);
				if (!this.stopping)
					await this.repository.recoverMissingFrontierReady(
						this.config.batchSize
					);
			})
			.catch((error: unknown) => {
				this.logger.error(
					'Archive broker optional frontier maintenance failed',
					{
						errorMessage: error instanceof Error ? error.message : String(error)
					}
				);
			})
			.finally(() => {
				this.pending = null;
				if (!this.stopping) this.onComplete();
			});
		return this.pending;
	}
	async close(): Promise<void> {
		this.stopping = true;
		await this.pending;
	}
}

/** Signal handlers and the run-loop finally must await the same drain before
 * the CLI destroys the shared DataSource. */
export function shareArchiveBrokerClose(
	close: () => Promise<void>
): () => Promise<void> {
	let closing: Promise<void> | null = null;
	return () => (closing ??= Promise.resolve().then(close));
}

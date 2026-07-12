import { randomUUID } from 'node:crypto';
import {
	FULL_HISTORY_BACKFILL_MAX_ATTEMPTS,
	type FullHistoryHistoricalBackfillJob
} from '../../domain/full-history-backfill/FullHistoryHistoricalBackfill.js';
import type { FullHistoryHistoricalBackfillRepository } from '../../domain/full-history-backfill/FullHistoryHistoricalBackfillRepository.js';
import { adjacentHistoricalBackfillRange } from '../../domain/full-history-backfill/FullHistoryHistoricalBackfillProgress.js';
import { assertInteger } from '../../domain/full-history/FullHistoryCanonicalTypes.js';

export type ScheduleFullHistoryBackfillResult =
	| { readonly status: 'canonical-unavailable' | 'history-complete' }
	| {
			readonly job: FullHistoryHistoricalBackfillJob;
			readonly status: 'existing' | 'scheduled';
	  };

export class ScheduleFullHistoryBackfill {
	constructor(
		private readonly repository: FullHistoryHistoricalBackfillRepository,
		private readonly createId: () => string = randomUUID
	) {}

	async execute(input: {
		readonly checkpointCount: number;
		readonly maxAttempts: number;
		readonly networkPassphrase: string;
	}): Promise<ScheduleFullHistoryBackfillResult> {
		const maxAttempts = assertInteger(
			input.maxAttempts,
			'maxAttempts',
			1,
			FULL_HISTORY_BACKFILL_MAX_ATTEMPTS
		);
		const frontier = await this.repository.findFrontier(
			input.networkPassphrase
		);
		if (frontier === null) return { status: 'canonical-unavailable' };
		const range = adjacentHistoricalBackfillRange(
			frontier,
			input.checkpointCount
		);
		if (range === null) return { status: 'history-complete' };

		const blocking = await this.repository.findBlockingJob(
			input.networkPassphrase
		);
		if (blocking !== null) return { job: blocking, status: 'existing' };

		const receipt = await this.repository.schedule({
			id: this.createId(),
			maxAttempts,
			networkPassphrase: input.networkPassphrase,
			range
		});
		return {
			job: receipt.job,
			status: receipt.created ? 'scheduled' : 'existing'
		};
	}
}

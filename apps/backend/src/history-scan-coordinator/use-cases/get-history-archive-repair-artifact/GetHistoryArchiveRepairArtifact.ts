import 'reflect-metadata';
import type { Readable } from 'node:stream';
import { inject, injectable } from 'inversify';
import type { HistoryArchiveRepairArtifactRepository } from '../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import {
	toRepairArtifactAvailability,
	type HistoryArchiveRepairArtifactAvailableV1,
	type HistoryArchiveRepairArtifactUnavailableV1
} from './HistoryArchiveRepairArtifactContract.js';

export type GetHistoryArchiveRepairArtifactResult =
	| {
			readonly artifact: HistoryArchiveRepairArtifactAvailableV1;
			readonly close: () => Promise<void>;
			readonly fileName: string;
			readonly status: 'available';
			readonly stream: Readable;
	  }
	| HistoryArchiveRepairArtifactUnavailableV1;

@injectable()
export class GetHistoryArchiveRepairArtifact {
	constructor(
		@inject(TYPES.HistoryArchiveRepairArtifactRepository)
		private readonly repository: HistoryArchiveRepairArtifactRepository
	) {}

	async execute(
		bucketHash: string
	): Promise<GetHistoryArchiveRepairArtifactResult> {
		const opened = await this.repository.openBucket(bucketHash);
		if (opened.status === 'unavailable') {
			return toRepairArtifactAvailability(
				opened
			) as HistoryArchiveRepairArtifactUnavailableV1;
		}

		const artifact = toRepairArtifactAvailability(opened);
		if (artifact.status !== 'available') {
			await opened.close();
			throw new Error('Proven repair artifact mapped to unavailable evidence');
		}

		return {
			artifact,
			close: opened.close,
			fileName: `bucket-${opened.bucketHash}.xdr.gz`,
			status: 'available',
			stream: opened.stream
		};
	}
}

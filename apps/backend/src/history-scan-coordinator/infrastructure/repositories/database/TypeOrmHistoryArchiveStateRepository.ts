import {
	getHistoryArchiveUrlIdentity,
	parseHistoryArchiveUrl
} from '@history-scan-coordinator/domain/ArchiveUrlIdentity.js';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveStateRepository } from '@history-scan-coordinator/domain/history-archive-state/HistoryArchiveStateRepository.js';
import {
	HistoryArchiveStateSnapshot,
	type HistoryArchiveStateFailureInput,
	type HistoryArchiveStateSource
} from '@history-scan-coordinator/domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import { injectable } from 'inversify';
import type { Repository } from 'typeorm';

const upsertConflictPaths: readonly (keyof HistoryArchiveStateSnapshot)[] = [
	'archiveUrlIdentity'
];

@injectable()
export class TypeOrmHistoryArchiveStateRepository implements HistoryArchiveStateRepository {
	constructor(
		private readonly repository: Repository<HistoryArchiveStateSnapshot>
	) {}

	async findAvailable(
		limit: number
	): Promise<readonly HistoryArchiveStateSnapshot[]> {
		if (!Number.isSafeInteger(limit) || limit < 1) return [];

		return await this.repository.find({
			where: { status: 'available' },
			order: { observedAt: 'DESC' },
			take: limit
		});
	}

	async findByUrl(url: string): Promise<HistoryArchiveStateSnapshot | null> {
		const archiveUrlIdentity = getHistoryArchiveUrlIdentity(url);
		if (archiveUrlIdentity === null) return null;

		return await this.repository.findOneBy({ archiveUrlIdentity });
	}

	async saveAvailable(
		archiveUrl: string,
		archiveMetadata: ArchiveMetadataDTO,
		source: HistoryArchiveStateSource
	): Promise<void> {
		const normalizedArchiveUrl = this.requireArchiveUrl(archiveUrl);
		const archiveUrlIdentity =
			this.requireArchiveUrlIdentity(normalizedArchiveUrl);
		const snapshot = HistoryArchiveStateSnapshot.available(
			normalizedArchiveUrl,
			archiveUrlIdentity,
			archiveMetadata,
			source
		);

		await this.repository.upsert(snapshot, [...upsertConflictPaths]);
		await this.markRootObjectCaptured(
			normalizedArchiveUrl,
			archiveUrlIdentity,
			archiveMetadata.stellarHistoryUrl
		);
	}

	async saveFailure(
		input: Omit<HistoryArchiveStateFailureInput, 'archiveUrlIdentity'>
	): Promise<void> {
		const normalizedArchiveUrl = this.requireArchiveUrl(input.archiveUrl);
		const archiveUrlIdentity =
			this.requireArchiveUrlIdentity(normalizedArchiveUrl);
		const snapshot = HistoryArchiveStateSnapshot.failure({
			...input,
			archiveUrl: normalizedArchiveUrl,
			archiveUrlIdentity
		});

		await this.repository.upsert(snapshot, [...upsertConflictPaths]);
	}

	private requireArchiveUrl(url: string): string {
		const parsedUrl = parseHistoryArchiveUrl(url);
		if (parsedUrl === null) throw new Error('Invalid history archive URL');

		return parsedUrl;
	}

	private requireArchiveUrlIdentity(url: string): string {
		const archiveUrlIdentity = getHistoryArchiveUrlIdentity(url);
		if (archiveUrlIdentity === null) {
			throw new Error('Invalid history archive URL identity');
		}

		return archiveUrlIdentity;
	}

	private async markRootObjectCaptured(
		archiveUrl: string,
		archiveUrlIdentity: string,
		stateUrl: string
	): Promise<void> {
		const objectRepository =
			this.repository.manager.getRepository(HistoryArchiveObject);

		await objectRepository
			.createQueryBuilder()
			.insert()
			.into(HistoryArchiveObject)
			.values(
				new HistoryArchiveObject({
					archiveUrl,
					archiveUrlIdentity,
					objectKey: 'root',
					objectOrder: 0,
					objectType: 'history-archive-state',
					objectUrl: stateUrl,
					status: 'verified'
				})
			)
			.orIgnore()
			.execute();

		await objectRepository
			.createQueryBuilder()
			.update(HistoryArchiveObject)
			.set({
				bytesDownloaded: null,
				claimedAt: null,
				claimedByCommunityScannerId: null,
				errorMessage: null,
				errorType: null,
				httpStatus: null,
				nextAttemptAt: null,
				refreshAfter: () => 'now() + make_interval(mins => 5)',
				status: 'verified',
				updatedAt: () => 'now()',
				verifiedAt: () => 'now()',
				workerStage: 'captured_history_archive_state'
			})
			.where('"archiveUrlIdentity" = :archiveUrlIdentity', {
				archiveUrlIdentity
			})
			.andWhere('"objectType" = :objectType', {
				objectType: 'history-archive-state'
			})
			.andWhere('"objectKey" = :objectKey', { objectKey: 'root' })
			.andWhere('status != :scanningStatus', {
				scanningStatus: 'scanning'
			})
			.execute();
	}
}

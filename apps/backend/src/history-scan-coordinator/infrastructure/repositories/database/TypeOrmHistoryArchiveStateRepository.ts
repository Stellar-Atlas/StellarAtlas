import {
	getHistoryArchiveUrlIdentity,
	parseHistoryArchiveUrl
} from '@history-scan-coordinator/domain/ArchiveUrlIdentity.js';
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
export class TypeOrmHistoryArchiveStateRepository
	implements HistoryArchiveStateRepository
{
	constructor(
		private readonly repository: Repository<HistoryArchiveStateSnapshot>
	) {}

	async findByUrl(
		url: string
	): Promise<HistoryArchiveStateSnapshot | null> {
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
		const archiveUrlIdentity = this.requireArchiveUrlIdentity(normalizedArchiveUrl);
		const snapshot = HistoryArchiveStateSnapshot.available(
			normalizedArchiveUrl,
			archiveUrlIdentity,
			archiveMetadata,
			source
		);

		await this.repository.upsert(snapshot, [...upsertConflictPaths]);
	}

	async saveFailure(
		input: Omit<HistoryArchiveStateFailureInput, 'archiveUrlIdentity'>
	): Promise<void> {
		const normalizedArchiveUrl = this.requireArchiveUrl(input.archiveUrl);
		const archiveUrlIdentity = this.requireArchiveUrlIdentity(normalizedArchiveUrl);
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
}

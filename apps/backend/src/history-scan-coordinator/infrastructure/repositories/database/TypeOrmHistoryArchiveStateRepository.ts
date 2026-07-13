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

		await this.repository.manager.query(
			`
				insert into "history_archive_state_snapshot" (
					"archiveUrl",
					"archiveUrlIdentity",
					"stateUrl",
					"status",
					"observedAt",
					"source",
					"version",
					"server",
					"currentLedger",
					"networkPassphrase",
					"currentBuckets",
					"hotArchiveBuckets",
					"rawState",
					"errorType",
					"errorMessage",
					"httpStatus"
				)
				values (
					$1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
					$11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16
				)
				on conflict ("archiveUrlIdentity") do update set
					"archiveUrl" = excluded."archiveUrl",
					"stateUrl" = excluded."stateUrl",
					"status" = excluded."status",
					"observedAt" = excluded."observedAt",
					"source" = excluded."source",
					"version" = excluded."version",
					"server" = excluded."server",
					"currentLedger" = excluded."currentLedger",
					"networkPassphrase" = excluded."networkPassphrase",
					"currentBuckets" = excluded."currentBuckets",
					"hotArchiveBuckets" = excluded."hotArchiveBuckets",
					"rawState" = excluded."rawState",
					"errorType" = excluded."errorType",
					"errorMessage" = excluded."errorMessage",
					"httpStatus" = excluded."httpStatus",
					"updatedAt" = now()
				where "history_archive_state_snapshot"."status" != 'available'
					or "history_archive_state_snapshot"."observedAt" <
						excluded."observedAt"
			`,
			[
				snapshot.archiveUrl,
				snapshot.archiveUrlIdentity,
				snapshot.stateUrl,
				snapshot.status,
				snapshot.observedAt,
				snapshot.source,
				snapshot.version,
				snapshot.server,
				snapshot.currentLedger,
				snapshot.networkPassphrase,
				toJsonParameter(snapshot.currentBuckets),
				toJsonParameter(snapshot.hotArchiveBuckets),
				toJsonParameter(snapshot.rawState),
				snapshot.errorType,
				snapshot.errorMessage,
				snapshot.httpStatus
			]
		);
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
		await this.repository.manager.query(
			`
				insert into "history_archive_state_snapshot" (
					"archiveUrl",
					"archiveUrlIdentity",
					"stateUrl",
					"status",
					"observedAt",
					"source",
					"errorType",
					"errorMessage",
					"httpStatus",
					"latestFailureObservedAt",
					"latestFailureSource",
					"latestFailureType",
					"latestFailureMessage",
					"latestFailureHttpStatus"
				)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $5, $6, $7, $8, $9)
				on conflict ("archiveUrlIdentity") do update set
					"archiveUrl" = excluded."archiveUrl",
					"latestFailureObservedAt" = excluded."latestFailureObservedAt",
					"latestFailureSource" = excluded."latestFailureSource",
					"latestFailureType" = excluded."latestFailureType",
					"latestFailureMessage" = excluded."latestFailureMessage",
					"latestFailureHttpStatus" = excluded."latestFailureHttpStatus",
					"stateUrl" = case
						when "history_archive_state_snapshot"."status" = 'available'
							then "history_archive_state_snapshot"."stateUrl"
						else excluded."stateUrl"
					end,
					"status" = case
						when "history_archive_state_snapshot"."status" = 'available'
							then "history_archive_state_snapshot"."status"
						else excluded."status"
					end,
					"observedAt" = case
						when "history_archive_state_snapshot"."status" = 'available'
							then "history_archive_state_snapshot"."observedAt"
						else excluded."observedAt"
					end,
					"source" = case
						when "history_archive_state_snapshot"."status" = 'available'
							then "history_archive_state_snapshot"."source"
						else excluded."source"
					end,
					"errorType" = case
						when "history_archive_state_snapshot"."status" = 'available'
							then "history_archive_state_snapshot"."errorType"
						else excluded."errorType"
					end,
					"errorMessage" = case
						when "history_archive_state_snapshot"."status" = 'available'
							then "history_archive_state_snapshot"."errorMessage"
						else excluded."errorMessage"
					end,
					"httpStatus" = case
						when "history_archive_state_snapshot"."status" = 'available'
							then "history_archive_state_snapshot"."httpStatus"
						else excluded."httpStatus"
					end,
					"updatedAt" = now()
				where
					"history_archive_state_snapshot"."latestFailureObservedAt" is null
					or "history_archive_state_snapshot"."latestFailureObservedAt" <
						excluded."latestFailureObservedAt"
			`,
			[
				normalizedArchiveUrl,
				archiveUrlIdentity,
				input.stateUrl,
				input.status,
				input.observedAt,
				input.source,
				input.errorType,
				input.errorMessage,
				input.httpStatus ?? null
			]
		);
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

function toJsonParameter(value: unknown): string | null {
	if (value === null) return null;
	const json = JSON.stringify(value);
	if (json === undefined)
		throw new Error('Archive state JSON is not serializable');
	return json;
}

import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../../database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';

export async function createObjectRepositoryDataSource(url: string): Promise<{
	readonly dataSource: DataSource;
	readonly repository: TypeOrmHistoryArchiveObjectRepository;
}> {
	const dataSource = new DataSource({
		dropSchema: true,
		entities: [HistoryArchiveObject],
		logging: false,
		synchronize: true,
		type: 'postgres',
		url
	});
	await dataSource.initialize();
	const queryRunner = dataSource.createQueryRunner();
	await new HistoryArchiveObjectHostThrottleMigration1784410000000().up(
		queryRunner
	);
	await new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
		queryRunner
	);
	await queryRunner.release();
	return {
		dataSource,
		repository: new TypeOrmHistoryArchiveObjectRepository(
			dataSource.getRepository(HistoryArchiveObject)
		)
	};
}

export async function saveHistoryArchiveObjects(
	dataSource: DataSource,
	...objects: HistoryArchiveObject[]
): Promise<void> {
	await dataSource.getRepository(HistoryArchiveObject).save(objects);
}

export async function insertHistoryArchiveHostThrottle(
	dataSource: DataSource,
	hostIdentity: string,
	blockedUntil: Date
): Promise<void> {
	await dataSource.query(
		`
		insert into history_archive_object_host_throttle (
			"hostIdentity", "archiveUrlIdentity", "failureClass",
			"evidenceClass", "errorType", "httpStatus", "blockedUntil",
			"lastFailureAt", "consecutiveFailures", "createdAt", "updatedAt"
		) values ($1, $2, 'rate-limit', 'archive-object', 'rate_limit', 429,
			$3, now(), 1, now(), now())
		`,
		[hostIdentity, `https://${hostIdentity}/archive`, blockedUntil]
	);
}

export async function countHistoryArchiveHostThrottles(
	dataSource: DataSource
): Promise<number> {
	const [{ count }] = (await dataSource.query(
		'select count(*)::int as count from history_archive_object_host_throttle'
	)) as Array<{ count: number }>;
	return count;
}

export function rootObject(
	archiveUrl: string,
	status: HistoryArchiveObject['status'] = 'pending'
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		objectKey: 'root',
		objectOrder: 0,
		objectType: 'history-archive-state',
		objectUrl: `${archiveUrl}/.well-known/stellar-history.json`,
		status
	});
}

export function checkpointObject(
	archiveUrl: string,
	checkpointLedger: number,
	status: HistoryArchiveObject['status'] = 'pending'
): HistoryArchiveObject {
	const hex = checkpointLedger.toString(16).padStart(8, '0');
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger,
		objectKey: `checkpoint-state:${hex}`,
		objectOrder: 10,
		objectType: 'checkpoint-state',
		objectUrl: `${archiveUrl}/history/${hex}.json`,
		status
	});
}

export function categoryObject(
	archiveUrl: string,
	checkpointLedger: number,
	objectType: 'ledger' | 'transactions',
	status: HistoryArchiveObject['status'] = 'pending'
): HistoryArchiveObject {
	const hex = checkpointLedger.toString(16).padStart(8, '0');
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger,
		objectKey: `${objectType}:${hex}`,
		objectOrder: objectType === 'ledger' ? 20 : 30,
		objectType,
		objectUrl: `${archiveUrl}/${objectType}/${hex}.xdr.gz`,
		status
	});
}

export function bucketObject(
	archiveUrl: string,
	bucketHash: string
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketHash,
		objectKey: `bucket:${bucketHash}`,
		objectOrder: 50,
		objectType: 'bucket',
		objectUrl: `${archiveUrl}/bucket-${bucketHash}.xdr.gz`
	});
}

export async function resetHistoryArchiveObjectQueue(
	dataSource: DataSource
): Promise<void> {
	await dataSource.query(
		'truncate table history_archive_object_queue restart identity cascade'
	);
	await dataSource.query(
		'truncate table history_archive_object_host_throttle restart identity cascade'
	);
	await dataSource.query(
		'truncate table history_archive_object_plan restart identity cascade'
	);
	await dataSource.query(`
		update history_archive_object_claim_slot
		set "objectRemoteId" = null, "claimedAt" = null, "updatedAt" = now()
	`);
}

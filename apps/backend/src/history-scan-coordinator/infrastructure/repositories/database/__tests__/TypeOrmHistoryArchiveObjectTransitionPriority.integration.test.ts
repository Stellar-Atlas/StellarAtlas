import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import {
	bucketObject,
	checkpointObject,
	createObjectRepositoryDataSource,
	rootObject,
	saveHistoryArchiveObjects
} from './HistoryArchiveObjectRepositoryFixture.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { publicNetworkPassphrase } from '../../../../domain/history-archive-object/HistoryArchiveObjectScpPolicy.js';

jest.setTimeout(60_000);

describe('archive transition proof priority', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveObjectRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource, repository } = await createObjectRepositoryDataSource(
			postgres.url
		));
		await createCanonicalFrontierTestSchema(dataSource);
		await dataSource.query(`
			create table if not exists
				history_archive_checkpoint_bucket_dependency (
					"archiveUrlIdentity" text not null,
					"checkpointLedger" integer not null,
					"bucketHash" text not null,
					primary key (
						"archiveUrlIdentity", "checkpointLedger", "bucketHash"
					)
				)
		`);
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate table history_archive_object_queue restart identity cascade'
		);
		await dataSource.query(
			'truncate table history_archive_state_snapshot, full_history_promotion_runtime, full_history_watermark, full_history_historical_backfill_job, history_archive_checkpoint_bucket_dependency'
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('reconciles canonical proof effects before older generic effects', async () => {
		const generic = verifiedTransition(
			'https://generic.example/archive',
			'planned-frontier',
			new Date('2026-01-01T00:00:00.000Z')
		);
		const canonical = verifiedTransition(
			'https://canonical.example/archive',
			'canonical-frontier-reserve',
			new Date('2026-01-02T00:00:00.000Z')
		);
		await saveHistoryArchiveObjects(dataSource, generic, canonical);

		const transitions = await repository.findUnreconciledTransitions(1);

		expect(transitions.map((object) => object.remoteId)).toEqual([
			canonical.remoteId
		]);
	});

	it('reconciles the current forward checkpoint before an older reserve transition', async () => {
		const archiveUrl = 'https://forward.example/archive';
		const checkpointLedger = 127;
		const generic = verifiedTransition(
			'https://generic.example/archive',
			'canonical-frontier-reserve',
			new Date('2026-01-01T00:00:00.000Z')
		);
		const target = checkpointObject(archiveUrl, checkpointLedger, 'failed');
		target.executionReason = 'frontier-waiting';
		target.transitionEffectsRequiredAt = new Date('2026-01-02T00:00:00.000Z');
		target.transitionEffectsCompletedAt = null;
		await saveHistoryArchiveObjects(dataSource, generic, target);
		await saveForwardRuntimeTarget(archiveUrl, checkpointLedger);

		const transitions = await repository.findUnreconciledTransitions(1);

		expect(transitions.map((object) => object.remoteId)).toEqual([
			target.remoteId
		]);
	});

	it('prioritizes a bucket required by the current forward checkpoint', async () => {
		const archiveUrl = 'https://bucket-target.example/archive';
		const checkpointLedger = 127;
		const bucketHash = 'a'.repeat(64);
		const generic = verifiedTransition(
			'https://generic.example/archive',
			'canonical-frontier-reserve',
			new Date('2026-01-01T00:00:00.000Z')
		);
		const target = bucketObject(archiveUrl, bucketHash);
		target.status = 'verified';
		target.executionReason = 'frontier-waiting';
		target.transitionEffectsRequiredAt = new Date('2026-01-02T00:00:00.000Z');
		target.transitionEffectsCompletedAt = null;
		await saveHistoryArchiveObjects(dataSource, generic, target);
		await saveForwardRuntimeTarget(archiveUrl, checkpointLedger);
		await dataSource.query(
			`insert into history_archive_checkpoint_bucket_dependency (
				"archiveUrlIdentity", "checkpointLedger", "bucketHash"
			) values ($1, $2, $3)`,
			[archiveUrl, checkpointLedger, bucketHash]
		);

		const transitions = await repository.findUnreconciledTransitions(1);

		expect(transitions.map((object) => object.remoteId)).toEqual([
			target.remoteId
		]);
	});

	async function saveForwardRuntimeTarget(
		archiveUrlIdentity: string,
		checkpointLedger: number
	): Promise<void> {
		await dataSource.query(
			`insert into history_archive_state_snapshot (
				"archiveUrlIdentity", status, "networkPassphrase"
			) values ($1, 'available', $2)`,
			[archiveUrlIdentity, publicNetworkPassphrase]
		);
		await dataSource.query(
			`insert into full_history_promotion_runtime (
				"network_passphrase_hash", state, "checkpoint_ledger"
			) values (sha256(convert_to($1, 'UTF8')), 'waiting-for-proof', $2)`,
			[publicNetworkPassphrase, checkpointLedger]
		);
	}
});

function verifiedTransition(
	archiveUrl: string,
	executionReason: string,
	requiredAt: Date
): HistoryArchiveObject {
	const object = rootObject(archiveUrl, 'verified');
	object.executionReason = executionReason;
	object.transitionEffectsRequiredAt = requiredAt;
	object.transitionEffectsCompletedAt = null;
	return object;
}

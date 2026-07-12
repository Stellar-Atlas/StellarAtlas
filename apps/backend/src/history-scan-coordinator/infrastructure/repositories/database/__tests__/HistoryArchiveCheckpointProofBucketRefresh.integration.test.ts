import { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { publicNetworkPassphrase } from '../../../../domain/history-archive-object/HistoryArchiveObjectScpPolicy.js';
import {
	createProofDataSource,
	proofArchiveUrl,
	proofBucketHash,
	proofCheckpointLedger,
	saveProofFixture
} from './HistoryArchiveCheckpointProofFixture.js';
import type { TypeOrmHistoryArchiveCheckpointProofRepository } from '../TypeOrmHistoryArchiveCheckpointProofRepository.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

const dependentCheckpointCount = 31;

jest.setTimeout(90_000);

describe('bounded bucket checkpoint proof refresh', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveCheckpointProofRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource, repository } = await createProofDataSource(postgres.url));
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate table history_archive_checkpoint_proof, history_archive_object_queue, history_archive_checkpoint_bucket_dependency, history_archive_state_snapshot, full_history_promotion_runtime restart identity cascade'
		);
		await saveProofFixture(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('marks every dependent checkpoint dirty but refreshes only the highest-priority proof immediately', async () => {
		const canonicalCheckpointLedger = proofCheckpointLedger + 5 * 64;
		const checkpointRepository = dataSource.getRepository(HistoryArchiveObject);
		const existing = await checkpointRepository.findOneByOrFail({
			archiveUrlIdentity: proofArchiveUrl,
			checkpointLedger: proofCheckpointLedger,
			objectType: 'checkpoint-state'
		});
		existing.dependenciesMaterializedAt = new Date('2026-01-01T00:00:00.000Z');
		await checkpointRepository.save(existing);

		for (let index = 1; index < dependentCheckpointCount; index += 1) {
			const ledger = proofCheckpointLedger + index * 64;
			const checkpoint = new HistoryArchiveObject({
				archiveUrl: proofArchiveUrl,
				archiveUrlIdentity: proofArchiveUrl,
				checkpointLedger: ledger,
				objectKey: `checkpoint-state:${ledger.toString(16).padStart(8, '0')}`,
				objectOrder: 10,
				objectType: 'checkpoint-state',
				objectUrl: `${proofArchiveUrl}/history-${ledger}.json`,
				status: 'verified'
			});
			checkpoint.dependenciesMaterializedAt = new Date(
				'2026-01-01T00:00:00.000Z'
			);
			await checkpointRepository.save(checkpoint);
			await dataSource.query(
				`insert into "history_archive_checkpoint_bucket_dependency" (
					"archiveUrlIdentity", "checkpointLedger", "bucketHash"
				) values ($1, $2, $3)`,
				[proofArchiveUrl, ledger, proofBucketHash]
			);
		}
		await dataSource.query(
			`insert into "history_archive_state_snapshot" (
				"archiveUrlIdentity", status, "networkPassphrase"
			) values ($1, 'available', $2)`,
			[proofArchiveUrl, publicNetworkPassphrase]
		);
		await dataSource.query(
			`insert into "full_history_promotion_runtime" (
				"network_passphrase_hash", state, "checkpoint_ledger"
			) values (sha256(convert_to($1, 'UTF8')), 'waiting-for-proof', $2)`,
			[publicNetworkPassphrase, canonicalCheckpointLedger]
		);

		const before = new Date();
		const bucket = await checkpointRepository.findOneByOrFail({
			archiveUrlIdentity: proofArchiveUrl,
			objectType: 'bucket'
		});
		await repository.refreshForObject(bucket);

		const [dirty] = (await dataSource.query(
			`select count(*)::integer as count
			 from "history_archive_object_queue"
			 where "archiveUrlIdentity" = $1
				and "objectType" = 'checkpoint-state'
				and "dependenciesMaterializedAt" >= $2`,
			[proofArchiveUrl, before]
		)) as readonly { readonly count: number }[];
		const proofCount = await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.countBy({ archiveUrlIdentity: proofArchiveUrl });
		const [refreshed] = await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.findBy({ archiveUrlIdentity: proofArchiveUrl });

		expect(dirty?.count).toBe(dependentCheckpointCount);
		expect(proofCount).toBe(1);
		expect(refreshed?.checkpointLedger).toBe(canonicalCheckpointLedger);
	});
});

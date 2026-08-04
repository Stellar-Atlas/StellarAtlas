import type { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { TypeOrmHistoryArchiveCheckpointProofRepository } from '../TypeOrmHistoryArchiveCheckpointProofRepository.js';
import {
	createProofDataSource,
	proofArchiveUrl,
	proofCheckpointLedger,
	refreshAndLoadProof,
	saveProofFixture
} from './HistoryArchiveCheckpointProofFixture.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(90_000);

describe('checkpoint proof refresh monotonicity', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveCheckpointProofRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource, repository } = await createProofDataSource(postgres.url));
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate table history_archive_checkpoint_proof, history_archive_object_queue, history_archive_checkpoint_bucket_dependency restart identity cascade'
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('does not overwrite newer equal-version evidence', async () => {
		await saveProofFixture(dataSource);
		await refreshAndLoadProof(dataSource, repository, proofCheckpointLedger);
		const futureEvaluation = new Date('2099-01-01T00:00:00.000Z');
		await dataSource.query(
			`update history_archive_checkpoint_proof
			 set status = 'mismatch', "failureKind" = 'result-hash-mismatch',
				"evaluatedAt" = $1
			 where "archiveUrlIdentity" = $2 and "checkpointLedger" = $3`,
			[futureEvaluation, proofArchiveUrl, proofCheckpointLedger]
		);

		await repository.refreshForArchiveCheckpoint({
			archiveUrlIdentity: proofArchiveUrl,
			bucketHash: null,
			checkpointLedger: proofCheckpointLedger
		});

		await expect(
			dataSource.getRepository(HistoryArchiveCheckpointProof).findOneByOrFail({
				archiveUrlIdentity: proofArchiveUrl,
				checkpointLedger: proofCheckpointLedger
			})
		).resolves.toMatchObject({
			evaluatedAt: futureEvaluation,
			failureKind: 'result-hash-mismatch',
			status: 'mismatch'
		});
	});

	it('does not downgrade a verified proof while its source is rechecked', async () => {
		await saveProofFixture(dataSource);
		const verified = await refreshAndLoadProof(
			dataSource,
			repository,
			proofCheckpointLedger
		);
		expect(verified).toMatchObject({ status: 'verified' });
		const preservedEvaluation = new Date('2026-01-01T00:00:00.000Z');
		await dataSource.getRepository(HistoryArchiveCheckpointProof).update(
			{
				archiveUrlIdentity: proofArchiveUrl,
				checkpointLedger: proofCheckpointLedger
			},
			{ evaluatedAt: preservedEvaluation }
		);

		await dataSource.getRepository(HistoryArchiveObject).update(
			{
				archiveUrlIdentity: proofArchiveUrl,
				checkpointLedger: proofCheckpointLedger,
				objectType: 'transactions'
			},
			{ status: 'scanning' }
		);

		const rechecked = await refreshAndLoadProof(
			dataSource,
			repository,
			proofCheckpointLedger
		);

		expect(rechecked).toMatchObject({
			evaluatedAt: preservedEvaluation,
			failureKind: null,
			status: 'verified'
		});

		await dataSource.getRepository(HistoryArchiveObject).update(
			{
				archiveUrlIdentity: proofArchiveUrl,
				checkpointLedger: proofCheckpointLedger,
				objectType: 'transactions'
			},
			{ status: 'verified' }
		);
		const reattested = await refreshAndLoadProof(
			dataSource,
			repository,
			proofCheckpointLedger
		);

		expect(reattested).toMatchObject({
			failureKind: null,
			status: 'verified'
		});
		expect(reattested?.evaluatedAt.getTime()).toBeGreaterThan(
			preservedEvaluation.getTime()
		);
	});
});

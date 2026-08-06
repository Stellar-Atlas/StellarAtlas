import type { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveCheckpointProofAttestationMigration1785420000000 } from '../../../database/migrations/1785420000000-HistoryArchiveCheckpointProofAttestationMigration.js';
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
		const queryRunner = dataSource.createQueryRunner();
		await new HistoryArchiveCheckpointProofAttestationMigration1785420000000().up(
			queryRunner
		);
		await queryRunner.release();
	});

	beforeEach(async () => {
		await dataSource.query(`
			truncate table
				history_archive_checkpoint_proof_attestation_invalidation,
				history_archive_checkpoint_proof_attestation,
				history_archive_checkpoint_proof_attested_checkpoint,
				history_archive_checkpoint_proof_attestation_rollup,
				history_archive_checkpoint_proof,
				history_archive_object_queue,
				history_archive_checkpoint_bucket_dependency
			restart identity cascade
		`);
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
			evaluatedAt: preservedEvaluation,
			failureKind: null,
			status: 'verified'
		});
	});

	it('retains a durable attestation while a newer proof version is pending', async () => {
		await saveProofFixture(dataSource);
		const verified = await refreshAndLoadProof(
			dataSource,
			repository,
			proofCheckpointLedger
		);
		expect(verified).toMatchObject({ status: 'verified' });

		await dataSource.query(
			`update history_archive_checkpoint_proof
			 set "failureKind" = 'same-timestamp-recheck'
			 where "archiveUrlIdentity" = $1 and "checkpointLedger" = $2`,
			[proofArchiveUrl, proofCheckpointLedger]
		);
		await dataSource.query(
			`update history_archive_checkpoint_proof
			 set "failureKind" = 'same-timestamp-recheck'
			 where "archiveUrlIdentity" = $1 and "checkpointLedger" = $2`,
			[proofArchiveUrl, proofCheckpointLedger]
		);
		const sameTimestampSnapshots = await dataSource.query<
			Array<{ readonly failureKind: string | null }>
		>(
			`select "proofSnapshot" ->> 'failureKind' as "failureKind"
			 from history_archive_checkpoint_proof_attestation
			 where "archiveUrlIdentity" = $1 and "checkpointLedger" = $2
			 order by id`,
			[proofArchiveUrl, proofCheckpointLedger]
		);
		expect(sameTimestampSnapshots).toEqual([
			{ failureKind: null },
			{ failureKind: 'same-timestamp-recheck' }
		]);

		await dataSource.query(
			`update history_archive_checkpoint_proof
			 set status = 'pending', "proofVersion" = $1, "evaluatedAt" = now()
			 where "archiveUrlIdentity" = $2 and "checkpointLedger" = $3`,
			[
				(verified?.proofVersion ?? 0) + 1,
				proofArchiveUrl,
				proofCheckpointLedger
			]
		);

		const rows = await dataSource.query<
			Array<{ readonly durableVerifiedCheckpointProofs: string }>
		>(
			`select "durableVerifiedCheckpointProofs"
			 from history_archive_checkpoint_proof_attestation_rollup
			 where "archiveUrlIdentity" = $1`,
			[proofArchiveUrl]
		);
		expect(Number(rows[0]?.durableVerifiedCheckpointProofs ?? 0)).toBe(1);

		await dataSource.query(
			`update history_archive_checkpoint_proof
			 set status = 'mismatch', "evaluatedAt" = now() + interval '1 millisecond'
			 where "archiveUrlIdentity" = $1 and "checkpointLedger" = $2`,
			[proofArchiveUrl, proofCheckpointLedger]
		);
		const outcomes = await dataSource.query<Array<{ readonly status: string }>>(
			`select status from history_archive_checkpoint_proof_attestation
			 where "archiveUrlIdentity" = $1 and "checkpointLedger" = $2
			 order by id`,
			[proofArchiveUrl, proofCheckpointLedger]
		);
		expect(outcomes.map(({ status }) => status)).toEqual([
			'verified',
			'verified',
			'mismatch'
		]);
		const durableAfterMismatch = await dataSource.query<
			Array<{ readonly durableVerifiedCheckpointProofs: string }>
		>(
			`select "durableVerifiedCheckpointProofs"
			 from history_archive_checkpoint_proof_attestation_rollup
			 where "archiveUrlIdentity" = $1`,
			[proofArchiveUrl]
		);
		expect(
			Number(
				durableAfterMismatch[0]?.durableVerifiedCheckpointProofs ?? 0
			)
		).toBe(1);

		await expect(
			dataSource.query(
				`update history_archive_checkpoint_proof_attestation
				 set status = 'mismatch'
				 where "archiveUrlIdentity" = $1`,
				[proofArchiveUrl]
			)
		).rejects.toThrow('append-only');

		await dataSource.query(
			`insert into history_archive_checkpoint_proof_attestation_invalidation
				("attestationId", reason, evidence)
			 select id, 'attestation-invalidated-by-test', '{}'::jsonb
			 from history_archive_checkpoint_proof_attestation
			 where "archiveUrlIdentity" = $1 and status = 'verified'`,
			[proofArchiveUrl]
		);
		await expect(
			dataSource.query(
				`update history_archive_checkpoint_proof_attestation_invalidation
				 set reason = 'mutated'`
			)
		).rejects.toThrow('append-only');

		const remaining = await dataSource.query<Array<{ readonly count: string }>>(
			`select count(*) from history_archive_verified_checkpoint_proof_attestation
			 where "archiveUrlIdentity" = $1`,
			[proofArchiveUrl]
		);
		expect(Number(remaining[0]?.count ?? 0)).toBe(0);

		const rollup = await dataSource.query<
			Array<{ readonly durableVerifiedCheckpointProofs: string }>
		>(
			`select "durableVerifiedCheckpointProofs"
			 from history_archive_checkpoint_proof_attestation_rollup
			 where "archiveUrlIdentity" = $1`,
			[proofArchiveUrl]
		);
		expect(Number(rollup[0]?.durableVerifiedCheckpointProofs ?? 0)).toBe(0);
	});
});

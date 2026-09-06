import { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { HistoryArchiveObjectRepository } from '../../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { CompleteHistoryArchiveObject } from '../../../../use-cases/complete-history-archive-object/CompleteHistoryArchiveObject.js';
import type { FailHistoryArchiveObject } from '../../../../use-cases/fail-history-archive-object/FailHistoryArchiveObject.js';
import { ReconcileHistoryArchiveObjectTransitions } from '../../../../use-cases/reconcile-history-archive-object-transitions/ReconcileHistoryArchiveObjectTransitions.js';
import { mapCheckpointProofRefreshFailure } from '../HistoryArchiveCheckpointProofRefreshFailure.js';
import { recordProofRefreshFailure } from '../HistoryArchiveCheckpointProofRefreshQueue.js';

const target = {
	archiveUrlIdentity: 'https://history.example/GALOU',
	checkpointLedger: 127,
	evidenceUpdatedAt: '2026-09-06T00:00:00.000Z',
	generation: 1,
	leaseToken: '11111111-1111-4111-8111-111111111111'
};
jest.setTimeout(60_000);

describe('checkpoint proof refresh exception diagnostics', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await dataSource.query(`
			create table history_archive_checkpoint_proof_refresh_queue (
				"archiveUrlIdentity" text not null, "checkpointLedger" integer not null,
				generation bigint not null, "leaseToken" uuid, "leaseUntil" timestamptz,
				attempts integer not null default 0, "lastError" text,
				"nextAttemptAt" timestamptz not null default now(),
				"updatedAt" timestamptz not null default now(),
				primary key ("archiveUrlIdentity", "checkpointLedger")
			)
		`);
	});
	beforeEach(async () => {
		await dataSource.query(
			'truncate history_archive_checkpoint_proof_refresh_queue'
		);
		await dataSource.query(
			`
			insert into history_archive_checkpoint_proof_refresh_queue
				("archiveUrlIdentity", "checkpointLedger", generation, "leaseToken", "leaseUntil")
			values ($1, $2, $3, $4, now() + interval '2 minutes')
		`,
			[
				target.archiveUrlIdentity,
				target.checkpointLedger,
				target.generation,
				target.leaseToken
			]
		);
	});
	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it.each([false, true])(
		'reports the actual fenced update outcome; stale generation=%s',
		async (stale) => {
			if (stale)
				await dataSource.query(
					'update history_archive_checkpoint_proof_refresh_queue set generation = 2'
				);
			const error = Object.assign(new Error('deadlock detected'), {
				driverError: { code: '40P01', message: 'deadlock detected' },
				query: 'SELECT private_value',
				parameters: ['private-password']
			});
			const query = jest.spyOn(dataSource, 'query');
			const failure = await recordProofRefreshFailure(
				dataSource,
				target,
				error
			);
			expect(query).toHaveBeenCalledTimes(1);
			expect(query.mock.calls[0]?.[0]).toContain(
				'returning "archiveUrlIdentity"'
			);
			query.mockRestore();
			expect(failure).toEqual({
				archiveUrlIdentity: target.archiveUrlIdentity,
				checkpointLedger: 127,
				databaseErrorCode: '40P01',
				errorMessage: 'deadlock detected',
				failureRecorded: !stale
			});
			expect(JSON.stringify(failure)).not.toMatch(
				/private_value|private-password/
			);
			const [row] = await dataSource.query(
				'select attempts, "lastError", "leaseToken" from history_archive_checkpoint_proof_refresh_queue'
			);
			expect(row.attempts).toBe(stale ? 0 : 1);
			expect(row.lastError).toBe(stale ? null : 'deadlock detected');
			expect(row.leaseToken).toBe(stale ? target.leaseToken : null);
		}
	);

	it('removes credentials, SQL payloads and extra lines from concise log messages', () => {
		const failure = mapCheckpointProofRefreshFailure(
			{
				...target,
				archiveUrlIdentity: target.archiveUrlIdentity + '?token=secret'
			},
			Object.assign(
				new Error(
					'password=private failed at postgresql://user:secret@host/db\nSTATEMENT: SELECT secret'
				),
				{
					code: 'not-a-sqlstate',
					query: 'SELECT secret',
					parameters: ['secret']
				}
			),
			false
		);
		expect(failure).toEqual({
			archiveUrlIdentity: target.archiveUrlIdentity,
			checkpointLedger: 127,
			databaseErrorCode: null,
			errorMessage: 'password=[redacted] failed at [URL]',
			failureRecorded: false
		});
		expect(
			mapCheckpointProofRefreshFailure(
				{
					...target,
					archiveUrlIdentity: 'https://user:secret@history.example'
				},
				new Error('x'.repeat(500)),
				false
			)
		).toMatchObject({
			archiveUrlIdentity: '[redacted]',
			errorMessage: 'x'.repeat(240)
		});
	});

	it('includes safe per-claim diagnostics in the existing aggregate failure log', async () => {
		const previous = process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_ENABLED;
		process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_ENABLED = 'true';
		try {
			const failure = mapCheckpointProofRefreshFailure(
				target,
				new Error('claim changed'),
				false
			);
			const repository = mock<HistoryArchiveObjectRepository>();
			repository.drainCheckpointProofRefreshQueue.mockResolvedValue({
				claimed: 3,
				completed: 2,
				failed: 1,
				failures: [failure]
			});
			const logger = mock<Logger>();
			const reconciler = new ReconcileHistoryArchiveObjectTransitions(
				repository,
				mock<CompleteHistoryArchiveObject>(),
				mock<FailHistoryArchiveObject>(),
				logger
			);
			expect(await reconciler.executeTargetedProofRefreshIfDue(10_000)).toBe(2);
			expect(logger.error).toHaveBeenCalledWith(
				'Failed targeted checkpoint proof refresh',
				{
					app: 'history-scan-coordinator',
					claimed: 3,
					completed: 2,
					failed: 1,
					failures: [failure]
				}
			);
		} finally {
			if (previous === undefined)
				delete process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_ENABLED;
			else
				process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_ENABLED = previous;
		}
	});
});

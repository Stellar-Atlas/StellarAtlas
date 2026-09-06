import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveCheckpointProofRefreshQueueMigration1785510000000 } from '../../../database/migrations/1785510000000-HistoryArchiveCheckpointProofRefreshQueueMigration.js';
import {
	refreshClaimedHistoryArchiveCheckpointProofs,
	type ClaimedHistoryArchiveCheckpointProofRefresh
} from '../HistoryArchiveCheckpointProofRefreshQueue.js';
import { historyArchiveCheckpointProofBatchQueuedRefreshSql } from '../HistoryArchiveCheckpointProofRefreshSql.js';
import {
	createProofDataSource,
	proofArchiveUrl,
	saveProofFixture
} from './HistoryArchiveCheckpointProofFixture.js';

jest.setTimeout(90_000);

describe('fenced checkpoint proof batch supersession', () => {
	let postgres: DisposablePostgres;
	let dataSource: DataSource;
	const originalBatchSize =
		process.env.HISTORY_ARCHIVE_CONSECUTIVE_PROOF_BATCH_SIZE;

	beforeAll(async () => {
		process.env.HISTORY_ARCHIVE_CONSECUTIVE_PROOF_BATCH_SIZE = '1';
		postgres = await startDisposablePostgres();
		({ dataSource } = await createProofDataSource(postgres.url));
		const runner = dataSource.createQueryRunner();
		try {
			await new HistoryArchiveCheckpointProofRefreshQueueMigration1785510000000().up(
				runner
			);
		} finally {
			await runner.release();
		}
	});

	beforeEach(async () => {
		await dataSource.query(`
			truncate history_archive_checkpoint_proof_refresh_queue,
				history_archive_checkpoint_proof, history_archive_object_queue,
				history_archive_checkpoint_bucket_dependency,
				history_archive_checkpoint_scan_cursor,
				history_archive_state_snapshot, full_history_promotion_runtime
				restart identity cascade
		`);
	});

	afterEach(() => jest.restoreAllMocks());

	afterAll(async () => {
		if (originalBatchSize === undefined) {
			delete process.env.HISTORY_ARCHIVE_CONSECUTIVE_PROOF_BATCH_SIZE;
		} else {
			process.env.HISTORY_ARCHIVE_CONSECUTIVE_PROOF_BATCH_SIZE =
				originalBatchSize;
		}
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('handles a same-generation claim with exact microsecond evidence in one SQL wave', async () => {
		await saveProofFixture(dataSource, { checkpointLedger: 63 });
		const target = await claim(63);
		const queries = jest.spyOn(dataSource.logger, 'logQuery');

		await expect(
			refreshClaimedHistoryArchiveCheckpointProofs(dataSource, [target])
		).resolves.toEqual({ completed: 1, superseded: 0 });

		expect(
			queries.mock.calls.filter(
				([sql]) => sql === historyArchiveCheckpointProofBatchQueuedRefreshSql
			)
		).toHaveLength(1);
		expect(await queue()).toEqual([]);
		expect(await proofStatus(63)).toEqual([{ status: 'verified' }]);
	});

	it('commits active work beside a superseded generation without retrying the batch', async () => {
		await saveProofFixture(dataSource, { checkpointLedger: 63 });
		const active = await claim(63);
		const stale = await claim(127);
		await requeueGeneration(stale);
		const queries = jest.spyOn(dataSource.logger, 'logQuery');

		await expect(
			refreshClaimedHistoryArchiveCheckpointProofs(dataSource, [active, stale])
		).resolves.toEqual({ completed: 1, superseded: 1 });

		expect(
			queries.mock.calls.filter(
				([sql]) => sql === historyArchiveCheckpointProofBatchQueuedRefreshSql
			)
		).toHaveLength(1);
		expect(await queue()).toEqual([
			expect.objectContaining({
				checkpointLedger: 127,
				generation: '2',
				leaseToken: null,
				attempts: 0,
				lastError: null
			})
		]);
		expect(await proofStatus(63)).toEqual([{ status: 'verified' }]);
		expect(await proofStatus(127)).toEqual([]);
	});

	it('leaves changed-generation work requeued without claiming completion or failure', async () => {
		const stale = await claim(63);
		await requeueGeneration(stale);
		await expect(
			refreshClaimedHistoryArchiveCheckpointProofs(dataSource, [stale])
		).resolves.toEqual({ completed: 0, superseded: 1 });
		expect(await queue()).toEqual([
			expect.objectContaining({
				generation: '2',
				leaseToken: null,
				attempts: 0,
				lastError: null
			})
		]);
		expect(await proofStatus(63)).toEqual([]);
	});

	it.each(['expired lease', 'changed evidence', 'replaced lease'])(
		'does not acknowledge an ineligible claim with %s',
		async (change) => {
			const stale = await claim(63);
			if (change === 'expired lease') {
				await dataSource.query(`update history_archive_checkpoint_proof_refresh_queue
					set "leaseUntil" = now() - interval '1 second'`);
			} else if (change === 'changed evidence') {
				await dataSource.query(`update history_archive_checkpoint_proof_refresh_queue
					set "evidenceUpdatedAt" = "evidenceUpdatedAt" + interval '1 microsecond'`);
			} else {
				await dataSource.query(
					`update history_archive_checkpoint_proof_refresh_queue
					set "leaseToken" = $1`,
					[randomUUID()]
				);
			}
			const before = await queue();
			await expect(
				refreshClaimedHistoryArchiveCheckpointProofs(dataSource, [stale])
			).resolves.toEqual({ completed: 0, superseded: 1 });
			expect(await queue()).toEqual(before);
			expect(await proofStatus(63)).toEqual([]);
		}
	);

	it('does not silently acknowledge an active claim whose proof has no source objects', async () => {
		const active = await claim(63);
		const before = await queue();
		await expect(
			refreshClaimedHistoryArchiveCheckpointProofs(dataSource, [active])
		).rejects.toThrow('valid targets for 1 claims');
		expect(await queue()).toEqual(before);
		expect(await proofStatus(63)).toEqual([]);
	});

	it('preserves the active claim and propagates a genuine PostgreSQL proof error', async () => {
		await saveProofFixture(dataSource, { checkpointLedger: 63 });
		const active = await claim(63);
		await dataSource.query(
			`
			update history_archive_object_queue
			set "verificationFacts" = jsonb_set("verificationFacts",
				'{ledgerCategory,ledgers,0,ledger}', '"not-a-ledger"'::jsonb)
			where "archiveUrlIdentity" = $1 and "objectType" = 'ledger'
		`,
			[proofArchiveUrl]
		);
		const before = await queue();

		await expect(
			refreshClaimedHistoryArchiveCheckpointProofs(dataSource, [active])
		).rejects.toMatchObject({ driverError: { code: '22P02' } });
		expect(await queue()).toEqual(before);
		expect(await proofStatus(63)).toEqual([]);
	});

	async function claim(
		checkpointLedger: number
	): Promise<ClaimedHistoryArchiveCheckpointProofRefresh> {
		const [row] = (await dataSource.query(
			`
			insert into history_archive_checkpoint_proof_refresh_queue (
				"archiveUrlIdentity", "checkpointLedger", "evidenceUpdatedAt",
				generation, "leaseToken", "leaseUntil"
			) values ($1, $2, '2026-09-06 01:02:03.123456+00', 1, $3,
				now() + interval '5 minutes')
			returning "archiveUrlIdentity", "checkpointLedger",
				"evidenceUpdatedAt"::text as "evidenceUpdatedAt", generation, "leaseToken"
		`,
			[proofArchiveUrl, checkpointLedger, randomUUID()]
		)) as readonly (Omit<
			ClaimedHistoryArchiveCheckpointProofRefresh,
			'generation'
		> & { readonly generation: string })[];
		if (row === undefined) throw new Error('Missing claim fixture');
		return { ...row, generation: Number(row.generation) };
	}

	async function requeueGeneration(
		target: ClaimedHistoryArchiveCheckpointProofRefresh
	): Promise<void> {
		await dataSource.query(
			`
			update history_archive_checkpoint_proof_refresh_queue
			set generation = generation + 1,
				"evidenceUpdatedAt" = "evidenceUpdatedAt" + interval '1 microsecond',
				"leaseToken" = null, "leaseUntil" = null
			where "archiveUrlIdentity" = $1 and "checkpointLedger" = $2
		`,
			[target.archiveUrlIdentity, target.checkpointLedger]
		);
	}

	async function queue(): Promise<unknown[]> {
		return await dataSource.query(`
			select "archiveUrlIdentity", "checkpointLedger", generation,
				"evidenceUpdatedAt"::text, "leaseToken", "leaseUntil",
				attempts, "lastError" from history_archive_checkpoint_proof_refresh_queue
			order by "checkpointLedger"
		`);
	}

	async function proofStatus(checkpointLedger: number): Promise<unknown[]> {
		return await dataSource.query(
			`
			select status from history_archive_checkpoint_proof
			where "archiveUrlIdentity" = $1 and "checkpointLedger" = $2
		`,
			[proofArchiveUrl, checkpointLedger]
		);
	}
});

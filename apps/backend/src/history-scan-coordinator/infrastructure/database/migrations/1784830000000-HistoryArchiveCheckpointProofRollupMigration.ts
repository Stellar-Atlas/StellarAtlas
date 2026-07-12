import { statfs } from 'node:fs/promises';
import { MigrationInterface, type QueryRunner } from 'typeorm';
import {
	runCheckpointProofRollupBackfill,
	type CheckpointProofRollupBackfillObserver
} from '../../repositories/database/HistoryArchiveCheckpointProofRollupBackfill.js';
import {
	checkpointProofRollupBatchSize,
	checkpointProofRollupLockTimeoutMs,
	checkpointProofRollupLooseIdentityCountSql,
	checkpointProofRollupMigrationLockSql,
	checkpointProofRollupMigrationUnlockSql,
	checkpointProofRollupStatementTimeoutMs
} from '../../repositories/database/HistoryArchiveCheckpointProofRollupSql.js';
import {
	assertCheckpointProofRollupDiskAvailable,
	estimateCheckpointProofRollupDisk
} from './HistoryArchiveCheckpointProofRollupDiskGuard.js';

const rootPath = '/';

export class HistoryArchiveCheckpointProofRollupMigration1784830000000 implements MigrationInterface {
	name = 'HistoryArchiveCheckpointProofRollupMigration1784830000000';
	transaction = false;

	constructor(
		private readonly backfillObserver: CheckpointProofRollupBackfillObserver = {}
	) {}

	async up(queryRunner: QueryRunner): Promise<void> {
		await withMigrationLock(queryRunner, async () => {
			await setSessionTimeouts(queryRunner);
			await assertProofRollupDiskCapacity(queryRunner);
			await createRollupTables(queryRunner);
			await runCheckpointProofRollupBackfill(
				queryRunner,
				this.backfillObserver
			);
		});
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await withMigrationLock(queryRunner, async () => {
			await setSessionTimeouts(queryRunner);
			await queryRunner.query(`
				drop trigger if exists "trg_history_archive_checkpoint_proof_rollup"
				on history_archive_checkpoint_proof
			`);
			await queryRunner.query(
				'drop function if exists refresh_history_archive_checkpoint_proof_rollup()'
			);
			await queryRunner.query(
				'drop table if exists history_archive_checkpoint_proof_rollup_progress'
			);
			await queryRunner.query(
				'drop table if exists history_archive_checkpoint_proof_rollup_state'
			);
			await queryRunner.query(
				'drop table if exists history_archive_checkpoint_proof_rollup'
			);
		});
	}
}

async function assertProofRollupDiskCapacity(
	queryRunner: QueryRunner
): Promise<void> {
	const [row] = (await queryRunner.query(
		checkpointProofRollupLooseIdentityCountSql
	)) as readonly { readonly archiveCount?: string }[];
	const estimate = estimateCheckpointProofRollupDisk(
		BigInt(row?.archiveCount ?? '0'),
		checkpointProofRollupBatchSize
	);
	let stats: Awaited<ReturnType<typeof statfs>>;
	try {
		stats = await statfs(rootPath);
	} catch (error) {
		throw new Error(
			`Checkpoint proof rollup cannot verify root free disk: ${String(error)}`
		);
	}
	const availableBytes = BigInt(stats.bavail) * BigInt(stats.bsize);
	assertCheckpointProofRollupDiskAvailable(estimate, availableBytes);
}

async function createRollupTables(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(`
		create table if not exists history_archive_checkpoint_proof_rollup (
			"archiveUrlIdentity" text not null,
			"totalCheckpointProofs" bigint not null default 0,
			"pendingCheckpointProofs" bigint not null default 0,
			"verifiedCheckpointProofs" bigint not null default 0,
			"mismatchCheckpointProofs" bigint not null default 0,
			"notEvaluableCheckpointProofs" bigint not null default 0,
			"objectCompleteCheckpointProofs" bigint not null default 0,
			"oldestCheckpointLedger" integer,
			"latestCheckpointLedger" integer,
			"updatedAt" timestamptz not null default now(),
			constraint "PK_history_archive_checkpoint_proof_rollup"
				primary key ("archiveUrlIdentity"),
			constraint "CHK_history_archive_checkpoint_proof_rollup_counts"
				check (
					"totalCheckpointProofs" >= 0
					and "pendingCheckpointProofs" >= 0
					and "verifiedCheckpointProofs" >= 0
					and "mismatchCheckpointProofs" >= 0
					and "notEvaluableCheckpointProofs" >= 0
					and "objectCompleteCheckpointProofs" >= 0
					and "objectCompleteCheckpointProofs" <= "totalCheckpointProofs"
					and "pendingCheckpointProofs"
						+ "verifiedCheckpointProofs"
						+ "mismatchCheckpointProofs"
						+ "notEvaluableCheckpointProofs"
						= "totalCheckpointProofs"
				)
		)
	`);
	await queryRunner.query(`
		create table if not exists history_archive_checkpoint_proof_rollup_state (
			"archiveUrlIdentity" text not null,
			"changeVersion" bigint not null default 0,
			"backfillComplete" boolean not null default false,
			"updatedAt" timestamptz not null default now(),
			constraint "PK_history_archive_checkpoint_proof_rollup_state"
				primary key ("archiveUrlIdentity"),
			constraint "CHK_history_archive_checkpoint_proof_rollup_state_version"
				check ("changeVersion" >= 0)
		)
	`);
	await queryRunner.query(`
		create table if not exists history_archive_checkpoint_proof_rollup_progress (
			id smallint not null,
			"cutoffProofId" bigint not null,
			"lastProofId" bigint not null,
			"complete" boolean not null default false,
			"updatedAt" timestamptz not null default now(),
			constraint "PK_history_archive_checkpoint_proof_rollup_progress"
				primary key (id),
			constraint "CHK_history_archive_checkpoint_proof_rollup_progress_id"
				check (id = 1),
			constraint "CHK_history_archive_checkpoint_proof_rollup_progress_bounds"
				check (
					"cutoffProofId" >= 0
					and "lastProofId" >= 0
					and "lastProofId" <= "cutoffProofId"
				)
		)
	`);
}

async function withMigrationLock(
	queryRunner: QueryRunner,
	operation: () => Promise<void>
): Promise<void> {
	if (queryRunner.isTransactionActive) {
		throw new Error('Checkpoint proof rollup requires transaction mode none');
	}
	const [lock] = (await queryRunner.query(
		checkpointProofRollupMigrationLockSql
	)) as readonly { readonly acquired?: boolean }[];
	if (lock?.acquired !== true) {
		throw new Error('Checkpoint proof rollup migration is already running');
	}

	try {
		await operation();
	} finally {
		if (queryRunner.isTransactionActive) {
			await queryRunner.rollbackTransaction();
		}
		try {
			await queryRunner.query('reset lock_timeout');
			await queryRunner.query('reset statement_timeout');
		} finally {
			await queryRunner.query(checkpointProofRollupMigrationUnlockSql);
		}
	}
}

async function setSessionTimeouts(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(
		`set lock_timeout = '${checkpointProofRollupLockTimeoutMs}ms'`
	);
	await queryRunner.query(
		`set statement_timeout = '${checkpointProofRollupStatementTimeoutMs}ms'`
	);
}

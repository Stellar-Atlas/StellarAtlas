import type { QueryRunner } from 'typeorm';
import {
	checkpointProofRollupArchiveAggregateSql,
	checkpointProofRollupBatchBoundarySql,
	checkpointProofRollupBatchSize,
	checkpointProofRollupBatchSql,
	checkpointProofRollupFinalizeRetries,
	checkpointProofRollupGlobalExclusiveLockSql,
	checkpointProofRollupGlobalSharedLockSql,
	checkpointProofRollupIdentityLockSql,
	checkpointProofRollupLockTimeoutMs,
	checkpointProofRollupPendingStateSql,
	checkpointProofRollupStatementTimeoutMs,
	checkpointProofRollupTriggerFunctionSql
} from './HistoryArchiveCheckpointProofRollupSql.js';

type ProgressRow = {
	readonly complete?: boolean;
	readonly cutoffProofId?: string;
	readonly lastProofId?: string;
};

type PendingStateRow = {
	readonly archiveUrlIdentity?: string;
	readonly changeVersion?: string;
};

type AggregateRow = {
	readonly latest?: number | null;
	readonly mismatch?: string;
	readonly notEvaluable?: string;
	readonly objectComplete?: string;
	readonly oldest?: number | null;
	readonly pending?: string;
	readonly total?: string;
	readonly verified?: string;
};

const maximumInitialBatches = 100_000;

export interface CheckpointProofRollupBackfillObserver {
	afterInitialBatch?(progress: {
		readonly cutoffProofId: bigint;
		readonly lastProofId: bigint;
	}): Promise<void> | void;
	beforeInitialBatchCommit?(progress: {
		readonly cutoffProofId: bigint;
		readonly lastProofId: bigint;
	}): Promise<void> | void;
}

export async function runCheckpointProofRollupBackfill(
	queryRunner: QueryRunner,
	observer: CheckpointProofRollupBackfillObserver = {}
): Promise<void> {
	await initializeCheckpointProofRollup(queryRunner);
	await accumulateInitialProofRows(queryRunner, observer);
	await finalizeArchiveRollups(queryRunner);
}

async function initializeCheckpointProofRollup(
	queryRunner: QueryRunner
): Promise<void> {
	assertNoOuterTransaction(queryRunner);
	await queryRunner.startTransaction();
	try {
		await setLocalTimeouts(queryRunner);
		// This lock protects only trigger/progress initialization, never row scans.
		await queryRunner.query(`
			lock table history_archive_checkpoint_proof
			in share row exclusive mode
		`);
		await queryRunner.query(`
			drop trigger if exists "trg_history_archive_checkpoint_proof_rollup"
			on history_archive_checkpoint_proof
		`);
		await queryRunner.query(checkpointProofRollupTriggerFunctionSql);
		const [progress] = (await queryRunner.query(`
			select id from history_archive_checkpoint_proof_rollup_progress
			where id = 1
		`)) as readonly { readonly id?: number }[];

		if (progress === undefined) {
			await queryRunner.query(
				'delete from history_archive_checkpoint_proof_rollup_state'
			);
			await queryRunner.query(
				'delete from history_archive_checkpoint_proof_rollup'
			);
			await queryRunner.query(`
				insert into history_archive_checkpoint_proof_rollup_progress (
					id, "cutoffProofId", "lastProofId", "complete", "updatedAt"
				)
				select 1, coalesce(max(id), 0), 0, false, now()
				from history_archive_checkpoint_proof
			`);
		}

		await queryRunner.query(`
			create trigger "trg_history_archive_checkpoint_proof_rollup"
			after insert or update or delete
			on history_archive_checkpoint_proof
			for each row execute function
				refresh_history_archive_checkpoint_proof_rollup()
		`);
		await queryRunner.commitTransaction();
	} catch (error) {
		await rollback(queryRunner);
		throw error;
	}
}

async function accumulateInitialProofRows(
	queryRunner: QueryRunner,
	observer: CheckpointProofRollupBackfillObserver
): Promise<void> {
	for (let batch = 0; batch < maximumInitialBatches; batch++) {
		const progress = await readProgress(queryRunner);
		if (progress.complete || progress.lastProofId >= progress.cutoffProofId) {
			return;
		}

		const next = await inTransaction(queryRunner, async () => {
			const batchEndProofId = await readBatchEndProofId(queryRunner, progress);
			const [result] = (await queryRunner.query(checkpointProofRollupBatchSql, [
				progress.lastProofId.toString(),
				batchEndProofId.toString(),
				checkpointProofRollupBatchSize
			])) as readonly ProgressRow[];
			const committedProgress = parseProgress(result);
			await observer.beforeInitialBatchCommit?.({
				cutoffProofId: committedProgress.cutoffProofId,
				lastProofId: committedProgress.lastProofId
			});
			return committedProgress;
		});
		if (next.lastProofId <= progress.lastProofId) {
			throw new Error('Checkpoint proof rollup backfill made no progress');
		}
		await observer.afterInitialBatch?.({
			cutoffProofId: next.cutoffProofId,
			lastProofId: next.lastProofId
		});
	}

	throw new Error('Checkpoint proof rollup exceeded its bounded batch limit');
}

async function readBatchEndProofId(
	queryRunner: QueryRunner,
	progress: {
		readonly cutoffProofId: bigint;
		readonly lastProofId: bigint;
	}
): Promise<bigint> {
	const [row] = (await queryRunner.query(
		checkpointProofRollupBatchBoundarySql,
		[
			progress.lastProofId.toString(),
			progress.cutoffProofId.toString(),
			checkpointProofRollupBatchSize
		]
	)) as readonly { readonly batchEndProofId?: string }[];
	if (row?.batchEndProofId === undefined) {
		throw new Error('Checkpoint proof rollup batch boundary is missing');
	}
	return BigInt(row.batchEndProofId);
}

async function finalizeArchiveRollups(queryRunner: QueryRunner): Promise<void> {
	while (true) {
		const pending = await readPendingState(queryRunner);
		if (pending === null) {
			if (await markGlobalBackfillComplete(queryRunner)) return;
			continue;
		}

		if (
			pending.changeVersion === 0n &&
			(await finalizeIdentity(
				queryRunner,
				pending.archiveUrlIdentity,
				pending.changeVersion,
				null
			))
		) {
			continue;
		}

		let expectedVersion = pending.changeVersion;
		let finalized = false;
		for (
			let attempt = 0;
			attempt < checkpointProofRollupFinalizeRetries;
			attempt++
		) {
			const aggregate = await readAggregate(
				queryRunner,
				pending.archiveUrlIdentity
			);
			finalized = await finalizeIdentity(
				queryRunner,
				pending.archiveUrlIdentity,
				expectedVersion,
				aggregate
			);
			if (finalized) break;
			const current = await readState(queryRunner, pending.archiveUrlIdentity);
			if (current === null || current.complete) {
				finalized = true;
				break;
			}
			expectedVersion = current.changeVersion;
		}

		if (!finalized) {
			throw new Error(
				`Checkpoint proof rollup source remained busy: ${pending.archiveUrlIdentity}`
			);
		}
	}
}

async function finalizeIdentity(
	queryRunner: QueryRunner,
	archiveUrlIdentity: string,
	expectedVersion: bigint,
	aggregate: Required<AggregateRow> | null
): Promise<boolean> {
	return inTransaction(queryRunner, async () => {
		await queryRunner.query(checkpointProofRollupGlobalSharedLockSql);
		await queryRunner.query(checkpointProofRollupIdentityLockSql, [
			archiveUrlIdentity
		]);
		const [state] = (await queryRunner.query(
			`
				select "changeVersion"::text as "changeVersion",
					"backfillComplete" as complete
				from history_archive_checkpoint_proof_rollup_state
				where "archiveUrlIdentity" = $1
				for update
			`,
			[archiveUrlIdentity]
		)) as readonly {
			readonly changeVersion?: string;
			readonly complete?: boolean;
		}[];
		if (state?.complete === true) return true;
		if (BigInt(state?.changeVersion ?? '-1') !== expectedVersion) return false;

		if (aggregate !== null) {
			await writeAbsoluteRollup(queryRunner, archiveUrlIdentity, aggregate);
		}
		const [row] = (await queryRunner.query(
			`
				with changed as (
					update history_archive_checkpoint_proof_rollup_state
					set "backfillComplete" = true, "updatedAt" = now()
					where "archiveUrlIdentity" = $1
						and "changeVersion" = $2::bigint
						and not "backfillComplete"
					returning 1
				)
				select exists (select 1 from changed) as changed
			`,
			[archiveUrlIdentity, expectedVersion.toString()]
		)) as readonly { readonly changed?: boolean }[];
		return row?.changed === true;
	});
}

async function writeAbsoluteRollup(
	queryRunner: QueryRunner,
	archiveUrlIdentity: string,
	aggregate: Required<AggregateRow>
): Promise<void> {
	if (BigInt(aggregate.total) === 0n) {
		await queryRunner.query(
			'delete from history_archive_checkpoint_proof_rollup where "archiveUrlIdentity" = $1',
			[archiveUrlIdentity]
		);
		return;
	}

	await queryRunner.query(
		`
			insert into history_archive_checkpoint_proof_rollup (
				"archiveUrlIdentity", "totalCheckpointProofs",
				"pendingCheckpointProofs", "verifiedCheckpointProofs",
				"mismatchCheckpointProofs", "notEvaluableCheckpointProofs",
				"objectCompleteCheckpointProofs", "oldestCheckpointLedger",
				"latestCheckpointLedger", "updatedAt"
			) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
			on conflict ("archiveUrlIdentity") do update set
				"totalCheckpointProofs" = excluded."totalCheckpointProofs",
				"pendingCheckpointProofs" = excluded."pendingCheckpointProofs",
				"verifiedCheckpointProofs" = excluded."verifiedCheckpointProofs",
				"mismatchCheckpointProofs" = excluded."mismatchCheckpointProofs",
				"notEvaluableCheckpointProofs" = excluded."notEvaluableCheckpointProofs",
				"objectCompleteCheckpointProofs" = excluded."objectCompleteCheckpointProofs",
				"oldestCheckpointLedger" = excluded."oldestCheckpointLedger",
				"latestCheckpointLedger" = excluded."latestCheckpointLedger",
				"updatedAt" = now()
		`,
		[
			archiveUrlIdentity,
			aggregate.total,
			aggregate.pending,
			aggregate.verified,
			aggregate.mismatch,
			aggregate.notEvaluable,
			aggregate.objectComplete,
			aggregate.oldest,
			aggregate.latest
		]
	);
}

async function markGlobalBackfillComplete(
	queryRunner: QueryRunner
): Promise<boolean> {
	return inTransaction(queryRunner, async () => {
		await queryRunner.query(checkpointProofRollupGlobalExclusiveLockSql);
		const [row] = (await queryRunner.query(`
			with changed as (
				update history_archive_checkpoint_proof_rollup_progress
				set
					"complete" = not exists (
						select 1
						from history_archive_checkpoint_proof_rollup_state
						where not "backfillComplete"
					),
					"updatedAt" = now()
				where id = 1
				returning "complete"
			)
			select "complete" from changed
		`)) as readonly { readonly complete?: boolean }[];
		return row?.complete === true;
	});
}

async function readProgress(queryRunner: QueryRunner): Promise<{
	readonly complete: boolean;
	readonly cutoffProofId: bigint;
	readonly lastProofId: bigint;
}> {
	const [row] = (await queryRunner.query(`
		select "complete", "cutoffProofId"::text as "cutoffProofId",
			"lastProofId"::text as "lastProofId"
		from history_archive_checkpoint_proof_rollup_progress
		where id = 1
	`)) as readonly ProgressRow[];
	return parseProgress(row);
}

function parseProgress(row: ProgressRow | undefined) {
	if (row?.cutoffProofId === undefined || row.lastProofId === undefined) {
		throw new Error('Checkpoint proof rollup progress is missing');
	}
	return {
		complete: row.complete === true,
		cutoffProofId: BigInt(row.cutoffProofId),
		lastProofId: BigInt(row.lastProofId)
	};
}

async function readPendingState(queryRunner: QueryRunner): Promise<{
	readonly archiveUrlIdentity: string;
	readonly changeVersion: bigint;
} | null> {
	const [row] = (await queryRunner.query(
		checkpointProofRollupPendingStateSql
	)) as readonly PendingStateRow[];
	if (row === undefined) return null;
	if (
		typeof row.archiveUrlIdentity !== 'string' ||
		row.changeVersion === undefined
	) {
		throw new Error('Checkpoint proof rollup state is invalid');
	}
	return {
		archiveUrlIdentity: row.archiveUrlIdentity,
		changeVersion: BigInt(row.changeVersion)
	};
}

async function readState(queryRunner: QueryRunner, archiveUrlIdentity: string) {
	const [row] = (await queryRunner.query(
		`
			select "backfillComplete" as complete,
				"changeVersion"::text as "changeVersion"
			from history_archive_checkpoint_proof_rollup_state
			where "archiveUrlIdentity" = $1
		`,
		[archiveUrlIdentity]
	)) as readonly {
		readonly changeVersion?: string;
		readonly complete?: boolean;
	}[];
	if (row === undefined) return null;
	return {
		changeVersion: BigInt(row.changeVersion ?? '-1'),
		complete: row.complete === true
	};
}

async function readAggregate(
	queryRunner: QueryRunner,
	archiveUrlIdentity: string
): Promise<Required<AggregateRow>> {
	const [row] = (await queryRunner.query(
		checkpointProofRollupArchiveAggregateSql,
		[archiveUrlIdentity]
	)) as readonly AggregateRow[];
	if (
		row?.total === undefined ||
		row.pending === undefined ||
		row.verified === undefined ||
		row.mismatch === undefined ||
		row.notEvaluable === undefined ||
		row.objectComplete === undefined
	) {
		throw new Error('Checkpoint proof rollup aggregate is missing');
	}
	return {
		total: row.total,
		pending: row.pending,
		verified: row.verified,
		mismatch: row.mismatch,
		notEvaluable: row.notEvaluable,
		objectComplete: row.objectComplete,
		oldest: row.oldest ?? null,
		latest: row.latest ?? null
	};
}

async function inTransaction<T>(
	queryRunner: QueryRunner,
	operation: () => Promise<T>
): Promise<T> {
	assertNoOuterTransaction(queryRunner);
	await queryRunner.startTransaction();
	try {
		await setLocalTimeouts(queryRunner);
		const result = await operation();
		await queryRunner.commitTransaction();
		return result;
	} catch (error) {
		await rollback(queryRunner);
		throw error;
	}
}

async function setLocalTimeouts(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(
		`set local lock_timeout = '${checkpointProofRollupLockTimeoutMs}ms'`
	);
	await queryRunner.query(
		`set local statement_timeout = '${checkpointProofRollupStatementTimeoutMs}ms'`
	);
}

function assertNoOuterTransaction(queryRunner: QueryRunner): void {
	if (queryRunner.isTransactionActive) {
		throw new Error('Checkpoint proof rollup requires transaction mode none');
	}
}

async function rollback(queryRunner: QueryRunner): Promise<void> {
	if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
}

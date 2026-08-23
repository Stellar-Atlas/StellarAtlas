import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	checkpointProofRollupTriggerFunctionSql,
	checkpointProofRollupTriggersSql
} from '../../repositories/database/HistoryArchiveCheckpointProofRollupSql.js';

const insertFunctionSql = `
create or replace function refresh_history_archive_checkpoint_proof_rollup_insert_statement()
returns trigger
language plpgsql
as $function$
begin
insert into history_archive_checkpoint_proof_rollup (
"archiveUrlIdentity",
"totalCheckpointProofs",
"pendingCheckpointProofs",
"verifiedCheckpointProofs",
"mismatchCheckpointProofs",
"notEvaluableCheckpointProofs",
"objectCompleteCheckpointProofs",
"oldestCheckpointLedger",
"latestCheckpointLedger",
"updatedAt"
)
select
"archiveUrlIdentity",
count(*),
count(*) filter (where status = 'pending'),
count(*) filter (where status = 'verified'),
count(*) filter (where status = 'mismatch'),
count(*) filter (where status = 'not-evaluable'),
count(*) filter (where "requiredObjectsComplete"),
min("checkpointLedger"),
max("checkpointLedger"),
now()
from new_proofs
group by "archiveUrlIdentity"
order by "archiveUrlIdentity"
on conflict ("archiveUrlIdentity") do update set
"totalCheckpointProofs" =
history_archive_checkpoint_proof_rollup."totalCheckpointProofs"
+ excluded."totalCheckpointProofs",
"pendingCheckpointProofs" =
history_archive_checkpoint_proof_rollup."pendingCheckpointProofs"
+ excluded."pendingCheckpointProofs",
"verifiedCheckpointProofs" =
history_archive_checkpoint_proof_rollup."verifiedCheckpointProofs"
+ excluded."verifiedCheckpointProofs",
"mismatchCheckpointProofs" =
history_archive_checkpoint_proof_rollup."mismatchCheckpointProofs"
+ excluded."mismatchCheckpointProofs",
"notEvaluableCheckpointProofs" =
history_archive_checkpoint_proof_rollup."notEvaluableCheckpointProofs"
+ excluded."notEvaluableCheckpointProofs",
"objectCompleteCheckpointProofs" =
history_archive_checkpoint_proof_rollup."objectCompleteCheckpointProofs"
+ excluded."objectCompleteCheckpointProofs",
"oldestCheckpointLedger" = least(
history_archive_checkpoint_proof_rollup."oldestCheckpointLedger",
excluded."oldestCheckpointLedger"
),
"latestCheckpointLedger" = greatest(
history_archive_checkpoint_proof_rollup."latestCheckpointLedger",
excluded."latestCheckpointLedger"
),
"updatedAt" = now();
return null;
end;
$function$
`;

export const checkpointProofRollupStatementUpdateFunctionSql = `
create or replace function refresh_history_archive_checkpoint_proof_rollup_update_statement()
returns trigger
language plpgsql
as $function$
begin
with changed as materialized (
select
old_proof."archiveUrlIdentity" as old_identity,
old_proof."checkpointLedger" as old_ledger,
old_proof.status as old_status,
old_proof."requiredObjectsComplete" as old_complete,
new_proof."archiveUrlIdentity" as new_identity,
new_proof."checkpointLedger" as new_ledger,
new_proof.status as new_status,
new_proof."requiredObjectsComplete" as new_complete
from old_proofs old_proof
join new_proofs new_proof using (id)
where old_proof."archiveUrlIdentity" is distinct from new_proof."archiveUrlIdentity"
or old_proof."checkpointLedger" is distinct from new_proof."checkpointLedger"
or old_proof.status is distinct from new_proof.status
or old_proof."requiredObjectsComplete"
is distinct from new_proof."requiredObjectsComplete"
), delta_rows as (
select
old_identity as identity,
-1 as total,
case when old_status = 'pending' then -1 else 0 end as pending,
case when old_status = 'verified' then -1 else 0 end as verified,
case when old_status = 'mismatch' then -1 else 0 end as mismatch,
case when old_status = 'not-evaluable' then -1 else 0 end as not_evaluable,
case when old_complete then -1 else 0 end as object_complete
from changed
union all
select
new_identity,
1,
case when new_status = 'pending' then 1 else 0 end,
case when new_status = 'verified' then 1 else 0 end,
case when new_status = 'mismatch' then 1 else 0 end,
case when new_status = 'not-evaluable' then 1 else 0 end,
case when new_complete then 1 else 0 end
from changed
), grouped as (
select
identity,
sum(total) as total,
sum(pending) as pending,
sum(verified) as verified,
sum(mismatch) as mismatch,
sum(not_evaluable) as not_evaluable,
sum(object_complete) as object_complete
from delta_rows
group by identity
)
update history_archive_checkpoint_proof_rollup rollup set
"totalCheckpointProofs" =
rollup."totalCheckpointProofs" + grouped.total,
"pendingCheckpointProofs" =
rollup."pendingCheckpointProofs" + grouped.pending,
"verifiedCheckpointProofs" =
rollup."verifiedCheckpointProofs" + grouped.verified,
"mismatchCheckpointProofs" =
rollup."mismatchCheckpointProofs" + grouped.mismatch,
"notEvaluableCheckpointProofs" =
rollup."notEvaluableCheckpointProofs" + grouped.not_evaluable,
"objectCompleteCheckpointProofs" =
rollup."objectCompleteCheckpointProofs" + grouped.object_complete,
"updatedAt" = now()
from grouped
where rollup."archiveUrlIdentity" = grouped.identity;

delete from history_archive_checkpoint_proof_rollup
where "totalCheckpointProofs" = 0;

with affected as (
select old_proof."archiveUrlIdentity" as identity
from old_proofs old_proof
join new_proofs new_proof using (id)
where old_proof."archiveUrlIdentity" is distinct from new_proof."archiveUrlIdentity"
or old_proof."checkpointLedger" is distinct from new_proof."checkpointLedger"
union
select new_proof."archiveUrlIdentity"
from old_proofs old_proof
join new_proofs new_proof using (id)
where old_proof."archiveUrlIdentity" is distinct from new_proof."archiveUrlIdentity"
or old_proof."checkpointLedger" is distinct from new_proof."checkpointLedger"
), bounds as (
select
proof."archiveUrlIdentity" as identity,
min(proof."checkpointLedger") as oldest,
max(proof."checkpointLedger") as latest
from history_archive_checkpoint_proof proof
join affected
on affected.identity = proof."archiveUrlIdentity"
group by proof."archiveUrlIdentity"
)
update history_archive_checkpoint_proof_rollup rollup set
"oldestCheckpointLedger" = bounds.oldest,
"latestCheckpointLedger" = bounds.latest
from bounds
where rollup."archiveUrlIdentity" = bounds.identity;
return null;
end;
$function$
`;

const deleteFunctionSql = `
create or replace function refresh_history_archive_checkpoint_proof_rollup_delete_statement()
returns trigger
language plpgsql
as $function$
begin
with grouped as (
select
"archiveUrlIdentity" as identity,
count(*) as total,
count(*) filter (where status = 'pending') as pending,
count(*) filter (where status = 'verified') as verified,
count(*) filter (where status = 'mismatch') as mismatch,
count(*) filter (where status = 'not-evaluable') as not_evaluable,
count(*) filter (where "requiredObjectsComplete") as object_complete
from old_proofs
group by "archiveUrlIdentity"
)
update history_archive_checkpoint_proof_rollup rollup set
"totalCheckpointProofs" = rollup."totalCheckpointProofs" - grouped.total,
"pendingCheckpointProofs" = rollup."pendingCheckpointProofs" - grouped.pending,
"verifiedCheckpointProofs" = rollup."verifiedCheckpointProofs" - grouped.verified,
"mismatchCheckpointProofs" = rollup."mismatchCheckpointProofs" - grouped.mismatch,
"notEvaluableCheckpointProofs" =
rollup."notEvaluableCheckpointProofs" - grouped.not_evaluable,
"objectCompleteCheckpointProofs" =
rollup."objectCompleteCheckpointProofs" - grouped.object_complete,
"updatedAt" = now()
from grouped
where rollup."archiveUrlIdentity" = grouped.identity;

delete from history_archive_checkpoint_proof_rollup
where "totalCheckpointProofs" = 0;

with affected as (
select distinct "archiveUrlIdentity" as identity
from old_proofs
), bounds as (
select
proof."archiveUrlIdentity" as identity,
min(proof."checkpointLedger") as oldest,
max(proof."checkpointLedger") as latest
from history_archive_checkpoint_proof proof
join affected
on affected.identity = proof."archiveUrlIdentity"
group by proof."archiveUrlIdentity"
)
update history_archive_checkpoint_proof_rollup rollup set
"oldestCheckpointLedger" = bounds.oldest,
"latestCheckpointLedger" = bounds.latest
from bounds
where rollup."archiveUrlIdentity" = bounds.identity;
return null;
end;
$function$
`;

const triggersSql = `
create trigger "trg_history_archive_checkpoint_proof_rollup_insert_statement"
after insert on history_archive_checkpoint_proof
referencing new table as new_proofs
for each statement execute function
refresh_history_archive_checkpoint_proof_rollup_insert_statement();

create trigger "trg_history_archive_checkpoint_proof_rollup_update_statement"
after update on history_archive_checkpoint_proof
referencing old table as old_proofs new table as new_proofs
for each statement execute function
refresh_history_archive_checkpoint_proof_rollup_update_statement();

create trigger "trg_history_archive_checkpoint_proof_rollup_delete_statement"
after delete on history_archive_checkpoint_proof
referencing old table as old_proofs
for each statement execute function
refresh_history_archive_checkpoint_proof_rollup_delete_statement()
`;

const oldTriggerNames = [
	'trg_history_archive_checkpoint_proof_rollup',
	'trg_history_archive_checkpoint_proof_rollup_write',
	'trg_history_archive_checkpoint_proof_rollup_update'
] as const;

const statementTriggerNames = [
	'trg_history_archive_checkpoint_proof_rollup_insert_statement',
	'trg_history_archive_checkpoint_proof_rollup_update_statement',
	'trg_history_archive_checkpoint_proof_rollup_delete_statement'
] as const;

const statementFunctionNames = [
	'refresh_history_archive_checkpoint_proof_rollup_insert_statement',
	'refresh_history_archive_checkpoint_proof_rollup_update_statement',
	'refresh_history_archive_checkpoint_proof_rollup_delete_statement'
] as const;

export class HistoryArchiveCheckpointProofStatementRollupMigration1785580000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveCheckpointProofStatementRollupMigration1785580000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await setMigrationBounds(queryRunner);
		await requireCompleteRollup(queryRunner);
		await dropTriggers(queryRunner, oldTriggerNames);
		await queryRunner.query(
			'drop function if exists refresh_history_archive_checkpoint_proof_rollup()'
		);
		await queryRunner.query(insertFunctionSql);
		await queryRunner.query(checkpointProofRollupStatementUpdateFunctionSql);
		await queryRunner.query(deleteFunctionSql);
		await queryRunner.query(triggersSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await setMigrationBounds(queryRunner);
		await dropTriggers(queryRunner, statementTriggerNames);
		for (const functionName of statementFunctionNames) {
			await queryRunner.query(`drop function if exists "${functionName}"()`);
		}
		await queryRunner.query(checkpointProofRollupTriggerFunctionSql);
		await queryRunner.query(checkpointProofRollupTriggersSql);
	}
}

async function setMigrationBounds(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(`
set local lock_timeout = '5s';
set local statement_timeout = '30s'
`);
}

async function requireCompleteRollup(queryRunner: QueryRunner): Promise<void> {
	const rows = (await queryRunner.query(`
select
coalesce((
select "complete"
from history_archive_checkpoint_proof_rollup_progress
where id = 1
), false) as complete,
exists (
select 1
from history_archive_checkpoint_proof
limit 1
) as "hasProofs"
`)) as Array<{ complete: boolean; hasProofs: boolean }>;
	const readiness = rows[0];
	if (readiness?.complete) return;
	if (readiness?.hasProofs) {
		throw new Error(
			'Checkpoint proof rollup must finish before statement triggers are installed'
		);
	}
	await queryRunner.query(`
update history_archive_checkpoint_proof_rollup_progress
set "complete" = true, "updatedAt" = now()
where id = 1
`);
}

async function dropTriggers(
	queryRunner: QueryRunner,
	triggerNames: readonly string[]
): Promise<void> {
	for (const triggerName of triggerNames) {
		await queryRunner.query(
			`drop trigger if exists "${triggerName}" on history_archive_checkpoint_proof`
		);
	}
}

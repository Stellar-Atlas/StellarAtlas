import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  archiveFailureSummaryRevisionColumnsSql,
  archiveEvidenceRootSummaryRevisionTriggerFunctionSql
} from '../../repositories/database/HistoryArchiveFailureSummaryRevisionRootSql.js';
import { archiveRetainedRemoteRevisionFunctionsSql } from '../../repositories/database/HistoryArchiveFailureSummaryRevisionRetainedSql.js';
import {
  archiveEvidenceRootSummaryRevisionStatementFunctionsSql,
  archiveEvidenceRootSummaryStatementPreimageSha256
} from '../../repositories/database/HistoryArchiveFailureSummaryRevisionStatementSql.js';

/** Additive compact metadata only. Never rebuild or scan archive object facts. */
export class HistoryArchiveFailureSummaryRevision1793577600000 implements MigrationInterface {
  readonly name = 'HistoryArchiveFailureSummaryRevision1793577600000';

  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) {
      throw new Error('Failure-summary revision migration requires one caller-owned transaction');
    }
    await runner.query("set local lock_timeout='250ms'");
    await runner.query("set local statement_timeout='5s'");
    // Inspect metadata before any DDL. The deployed root counters are batched
    // INSERT/UPDATE statements plus row DELETE; never replace that topology.
    const layout: { ready: boolean }[] = await runner.query(`
      with expected(name,signature,kind,old_table,new_table,body_hash) as (values
        ('trg_history_archive_evidence_root_summary_insert',
          'public.refresh_history_archive_evidence_root_summary_insert_statement()',4,null::text,'new_rows',$1::text),
        ('trg_history_archive_evidence_root_summary_update',
          'public.refresh_history_archive_evidence_root_summary_update_statement()',16,'old_rows','new_rows',$2::text),
        ('trg_history_archive_evidence_root_summary_delete',
          'public.refresh_history_archive_evidence_root_summary()',9,null::text,null::text,$3::text)
      ), checked as (
        select expected.name, trg.oid is not null and trg.tgtype=expected.kind
          and trg.tgenabled='O' and trg.tgnargs=0 and trg.tgattr::text=''
          and trg.tgqual is null and trg.tgfoid=to_regprocedure(expected.signature)
          and trg.tgoldtable is not distinct from expected.old_table
          and trg.tgnewtable is not distinct from expected.new_table
          and proc.prosecdef=false and proc.provolatile='v'
          and proc.prorettype='trigger'::regtype and lang.lanname='plpgsql'
          and encode(sha256(convert_to(btrim(replace(proc.prosrc,E'\\r\\n',E'\\n'),E' \\t\\r\\n'),'UTF8')),'hex')=expected.body_hash
          as compatible
        from expected left join pg_trigger trg
          on trg.tgrelid=to_regclass('public.history_archive_object_queue')
          and trg.tgname=expected.name and not trg.tgisinternal
        left join pg_proc proc on proc.oid=trg.tgfoid
        left join pg_language lang on lang.oid=proc.prolang
      ) select current_schema()='public'
        and coalesce((select count(*)=3 and bool_and(compatible) from checked),false)
        and not exists(select 1 from pg_trigger where
          tgrelid=to_regclass('public.history_archive_object_queue')
          and tgname='trg_history_archive_evidence_root_summary' and not tgisinternal)
        and (select count(*)=3 from pg_trigger where
          tgrelid=to_regclass('public.history_archive_object_queue') and not tgisinternal
          and tgfoid in (select to_regprocedure(signature) from expected))
        and not exists(select 1 from pg_trigger where
          tgrelid=to_regclass('public.history_archive_object_queue') and not tgisinternal
          and tgname like 'trg_history_archive_evidence_root_summary%'
          and tgname not in (select name from expected)
          and not (tgname='trg_history_archive_evidence_root_summary_truncate' and tgtype=32
            and tgenabled='O' and tgfoid=to_regprocedure('public.reset_history_archive_evidence_root_summary()')))
        and (select count(*)=1 and bool_and(
          tgname='history_archive_retain_remote_transition' and tgtype=16
          and tgenabled in ('O','D') and tgnargs=0 and tgattr::text='' and tgqual is null
          and tgoldtable='old_objects' and tgnewtable='new_objects')
          from pg_trigger where tgrelid=to_regclass('public.history_archive_object_queue')
          and not tgisinternal and tgfoid=to_regprocedure('public.retain_history_archive_remote_findings()'))
        as ready
    `, [archiveEvidenceRootSummaryStatementPreimageSha256.insert,
      archiveEvidenceRootSummaryStatementPreimageSha256.update,
      archiveEvidenceRootSummaryStatementPreimageSha256.delete]);
    if (layout[0]?.ready !== true) {
      throw new Error('Unknown archive root-summary statement/row trigger preimage or retained trigger layout; no DDL applied');
    }
    const progress: { complete: boolean }[] = await runner.query(
      'select complete from history_archive_evidence_root_summary_progress where id=1'
    );
    if (progress[0]?.complete !== true) {
      throw new Error('Existing archive root-summary backfill must be complete first');
    }
    // Run under the existing common summary owner. Do not grant new privileges
    // or create another service credential as a migration side effect.
    const owners: { ownerReady: boolean }[] = await runner.query(`
      select count(*)=3 and bool_and(pg_get_userbyid(relowner)=current_user) as "ownerReady"
      from pg_class where oid in (
        to_regclass('history_archive_evidence_root_summary'),
        to_regclass('history_archive_retained_remote_summary'),
        to_regclass('history_archive_failure_summary_snapshot'))
    `);
    if (owners[0]?.ownerReady !== true) {
      throw new Error('Apply as the existing common summary owner; runtime sequence access needs an explicit release preflight');
    }
    for (const table of [
      'history_archive_evidence_root_summary',
      'history_archive_retained_remote_summary',
      'history_archive_failure_summary_snapshot'
    ]) {
      const rows: { count: number }[] = await runner.query(
        `select count(*)::int as count from (select 1 from ${table} limit 10001) bounded`
      );
      if ((rows[0]?.count ?? 10001) > 10000) {
        throw new Error('Compact-summary migration row budget exceeded');
      }
    }

    await runner.query(archiveFailureSummaryRevisionColumnsSql);
    await runner.query(`alter table history_archive_failure_summary_snapshot
      add column "sourceRootRevision" bigint,
      add column "sourceRetainedRevision" text,
      add column "sourceQueryHash" text,
      add column "sourceSummaryHash" text`);
    // Fail before changing trigger behavior if any existing login or explicitly
    // authorized queue writer cannot execute the new invoker operations. No
    // GRANT/PUBLIC privilege expansion is performed by this migration.
    const access: { writerReady: boolean }[] = await runner.query(`
      with explicit_writers as (
        select grantee from pg_class relation,
          lateral aclexplode(coalesce(relation.relacl,
            acldefault('r',relation.relowner))) permission
        where relation.oid=to_regclass('history_archive_object_queue')
          and permission.privilege_type in ('INSERT','UPDATE','DELETE')
      ), writers as (
        select role.oid from pg_roles role
        where (role.rolcanlogin or role.oid in (select grantee from explicit_writers))
          and (has_table_privilege(role.oid,'history_archive_object_queue','INSERT')
            or has_table_privilege(role.oid,'history_archive_object_queue','UPDATE')
            or has_table_privilege(role.oid,'history_archive_object_queue','DELETE'))
        limit 1001
      ) select count(*) between 1 and 1000
        and not exists(select 1 from explicit_writers where grantee=0)
        and bool_and(
          has_table_privilege(oid,'history_archive_retained_remote_finding','SELECT')
          and (has_sequence_privilege(oid,'history_archive_failure_summary_revision_seq','USAGE')
            or has_sequence_privilege(oid,'history_archive_failure_summary_revision_seq','UPDATE'))
          and has_column_privilege(oid,'history_archive_evidence_root_summary','failureSummaryRevision','SELECT')
          and has_column_privilege(oid,'history_archive_evidence_root_summary','failureSummaryRevision','INSERT')
          and has_column_privilege(oid,'history_archive_evidence_root_summary','failureSummaryRevision','UPDATE')
          and has_column_privilege(oid,'history_archive_retained_remote_summary','failureSummaryRevision','SELECT')
          and has_column_privilege(oid,'history_archive_retained_remote_summary','failureSummaryRevision','INSERT')
          and has_column_privilege(oid,'history_archive_retained_remote_summary','failureSummaryRevision','UPDATE')
        ) as "writerReady" from writers
    `);
    if (access[0]?.writerReady !== true) {
      throw new Error('Existing archive writer privileges need review before activating revision triggers; no automatic grants');
    }
    // Establish a unique initial baseline using only the bounded compact rows.
    await runner.query(`update history_archive_evidence_root_summary
      set "failureSummaryRevision"=nextval('history_archive_failure_summary_revision_seq')`);
    await runner.query(`update history_archive_retained_remote_summary
      set "failureSummaryRevision"=nextval('history_archive_failure_summary_revision_seq')`);
    await runner.query(archiveEvidenceRootSummaryRevisionTriggerFunctionSql);
    await runner.query(archiveEvidenceRootSummaryRevisionStatementFunctionsSql);
    await runner.query(archiveRetainedRemoteRevisionFunctionsSql);

    // Row invalidation does not cover TRUNCATE. A wholesale fact reset must use
    // an explicitly reviewed rebuild protocol, not leave old tokens current.
    await runner.query(`create function reject_history_archive_failure_input_truncate()
      returns trigger language plpgsql as $guard$
      begin
        raise exception 'Archive finding inputs require a fenced rebuild; TRUNCATE is not supported'
          using errcode='55000';
      end $guard$`);
    await runner.query(`create trigger trg_history_archive_queue_failure_truncate_guard
      before truncate on history_archive_object_queue for each statement
      execute function reject_history_archive_failure_input_truncate()`);
    await runner.query(`create trigger trg_history_archive_retained_failure_truncate_guard
      before truncate on history_archive_retained_remote_finding for each statement
      execute function reject_history_archive_failure_input_truncate()`);

    // Existing INSERT/UPDATE statement and DELETE row trigger definitions stay
    // intact. Retained capture remains in its observed O/D state, unchanged.
  }

  async down(): Promise<void> {
    // Old applications ignore the additive metadata. Retain its counters and
    // last-good provenance on code rollback instead of dropping source state.
    throw new Error('Rollback application code while retaining additive failure-summary metadata; no destructive automatic down migration');
  }
}

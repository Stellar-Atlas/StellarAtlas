/** Hints only: LISTEN before snapshot, reconcile after reconnect and periodically.
 * No table writes or cross-relation reads/locks are introduced by these triggers. */
export const historyArchiveRamNotificationChannel =
	'stellaratlas_history_archive_ram';
export const historyArchiveRamNotificationChunkSize = 128;

const idRelations = [
	['history_archive_object_ready', 'objectRemoteId'],
	['history_archive_broker_candidate', 'remoteId']
] as const;
const contextRelations = [
	'history_archive_root_failure_control',
	'history_archive_object_host_throttle',
	'history_archive_object_claim_slot'
] as const;

function transitionTrigger(
	table: string,
	operation: string,
	fn: string
): string {
	const old = operation === 'insert' ? '' : 'old table as old_rows';
	const next = operation === 'delete' ? '' : 'new table as new_rows';
	return `create trigger ${table}_ram_${operation}
	after ${operation} on ${table} referencing ${old} ${next}
	for each statement execute function ${fn};`;
}

export const historyArchiveRamFeedNotificationsSql = `
create function history_archive_notify_ram_ids() returns trigger language plpgsql as $$
declare relation_sql text; chunk record;
begin
  if TG_OP='INSERT' then relation_sql := 'select %I as id from new_rows';
  elsif TG_OP='DELETE' then relation_sql := 'select %I as id from old_rows';
  else
    -- Detect deletes/key changes too, without inspecting any durable evidence.
    relation_sql := 'select coalesce(n.%1$I,o.%1$I) as id
      from new_rows n full join old_rows o on n.%1$I=o.%1$I
      where n is distinct from o';
  end if;
  for chunk in execute 'select json_build_object(''ids'',array_agg(id order by id))::text as payload
    from (select id,(row_number() over(order by id)-1)/128 as chunk
      from (' || format(relation_sql,TG_ARGV[0]) || ') changed) numbered group by chunk'
  loop
    perform pg_notify('${historyArchiveRamNotificationChannel}',chunk.payload);
  end loop;
  return null;
end $$;
create function history_archive_notify_ram_context() returns trigger language plpgsql as $$
declare changed boolean;
begin
  if TG_OP='TRUNCATE' then
    perform pg_notify('${historyArchiveRamNotificationChannel}','{"reset":true}');
    return null;
  elsif TG_OP='DELETE' then select exists(select 1 from old_rows) into changed;
  elsif TG_OP='INSERT' then select exists(select 1 from new_rows) into changed;
  else
    select exists(select 1 from ((select * from new_rows except select * from old_rows)
      union all (select * from old_rows except select * from new_rows)) delta) into changed;
  end if;
  if changed then perform pg_notify('${historyArchiveRamNotificationChannel}','{"context":true}'); end if;
  return null;
end $$;
${idRelations
	.flatMap(([table, id]) =>
		['insert', 'update', 'delete'].map((op) =>
			transitionTrigger(table, op, `history_archive_notify_ram_ids('${id}')`)
		)
	)
	.join('\n')}
${contextRelations
	.flatMap((table) =>
		['insert', 'update', 'delete'].map((op) =>
			transitionTrigger(table, op, 'history_archive_notify_ram_context()')
		)
	)
	.join('\n')}
${[...idRelations.map(([table]) => table), ...contextRelations]
	.map(
		(table) =>
			`create trigger ${table}_ram_truncate after truncate on ${table}
	for each statement execute function history_archive_notify_ram_context();`
	)
	.join('\n')}
`;

export const dropHistoryArchiveRamFeedNotificationsSql = `
${[...idRelations.map(([table]) => table), ...contextRelations]
	.flatMap((table) =>
		['insert', 'update', 'delete', 'truncate'].map(
			(op) => `drop trigger if exists ${table}_ram_${op} on ${table};`
		)
	)
	.join('\n')}
drop function if exists history_archive_notify_ram_ids();
drop function if exists history_archive_notify_ram_context();
`;

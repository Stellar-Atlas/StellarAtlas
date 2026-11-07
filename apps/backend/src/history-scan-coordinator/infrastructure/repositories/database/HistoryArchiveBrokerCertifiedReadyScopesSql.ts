import assert from 'node:assert/strict';
const rootWalk = "ready_roots AS (\n    (SELECT r.\"archiveUrlIdentity\", 1 AS ordinal\n     FROM history_archive_object_ready r\n     WHERE r.\"publishedAt\" IS NULL AND r.\"archiveUrlIdentity\" IS NOT NULL\n     ORDER BY r.\"archiveUrlIdentity\" LIMIT 1)\n    UNION ALL\n    SELECT next_root.\"archiveUrlIdentity\", root.ordinal + 1\n    FROM ready_roots root\n    CROSS JOIN LATERAL (\n        SELECT r.\"archiveUrlIdentity\"\n        FROM history_archive_object_ready r\n        WHERE r.\"publishedAt\" IS NULL\n          AND r.\"archiveUrlIdentity\" > root.\"archiveUrlIdentity\"\n        ORDER BY r.\"archiveUrlIdentity\" LIMIT 1\n    ) next_root\n    WHERE root.ordinal < 257\n)";

// All keys come from the database snapshot. The fourth priority or eighth
// category, like the 257th root, is a sentinel, not a truncated work list.
const domains = `with recursive ${rootWalk},
	root_budget as materialized (select exists(select 1 from ready_roots where ordinal=257) exceeded),
	ready_priorities as (
		select roots."archiveUrlIdentity", first.priority, 1 as ordinal
		from ready_roots roots
		cross join lateral (
			select r.priority from history_archive_object_ready r
			where r."archiveUrlIdentity"=roots."archiveUrlIdentity" and r."publishedAt" is null
			  and r.priority<=$3::smallint order by r.priority limit 1
		) first where not (select exceeded from root_budget)
		union all
		select previous."archiveUrlIdentity", next.priority, previous.ordinal+1
		from ready_priorities previous
		cross join lateral (
			select r.priority from history_archive_object_ready r
			where r."archiveUrlIdentity"=previous."archiveUrlIdentity" and r."publishedAt" is null
			  and r.priority>previous.priority and r.priority<=$3::smallint order by r.priority limit 1
		) next where previous.ordinal<4
	), candidate_categories as (
		select roots."archiveUrlIdentity", first."objectType", 1 as ordinal
		from ready_roots roots
		cross join lateral (
			select c."objectType" from history_archive_broker_candidate c
			where c."archiveUrlIdentity"=roots."archiveUrlIdentity" and c.status='pending' and c.attempts=0
			order by c."objectType" limit 1
		) first where not (select exceeded from root_budget)
		union all
		select previous."archiveUrlIdentity", next."objectType", previous.ordinal+1
		from candidate_categories previous
		cross join lateral (
			select c."objectType" from history_archive_broker_candidate c
			where c."archiveUrlIdentity"=previous."archiveUrlIdentity" and c.status='pending' and c.attempts=0
			  and c."objectType">previous."objectType" order by c."objectType" limit 1
		) next where previous.ordinal<8
	), discovery_budget as materialized (
		select (select exceeded from root_budget)
			or exists(select 1 from ready_priorities where ordinal=4)
			or exists(select 1 from candidate_categories where ordinal=8) as exceeded
	)`;
const scopes = `ready_scopes as materialized (
	select p."archiveUrlIdentity", p.priority, c."objectType",
		'-2147483648'::integer as first_checkpoint, 2147483647::integer as last_checkpoint,
		true as has_null_checkpoint
	from ready_priorities p join candidate_categories c using ("archiveUrlIdentity")
	where not (select exceeded from discovery_budget)
)`;
const columns = [
	'"objectRemoteId"', '"archiveUrlIdentity"', 'stored_priority', 'priority', 'is_first_pass',
	'"dispatchToken"', '"updatedAt"', '"hostIdentity"', '"checkpointLedger"', '"objectOrder"',
	'"objectType"', 'control_scope', 'is_transient_source_retry', 'is_retry', 'active_count',
	'first_pass_root_ready_at'
];

// Preserve the original fresh CTEs unchanged as the authoritative fallback.
// The indexed branch retains a pre-ranking witness bit for every admitted row
// in every numeric/null prefix, including rows later excluded by a host cap.
// Aligned rows witness their own legacy scope and checkpoint range. If all
// prefix rows align, the legacy subset has exactly those same ordered prefixes.
export function withCertifiedReadyScopes(firstPassSql: string): string {
	const ageStart = ', fresh_age_categories as materialized (';
	const recoveryStart = /,\s*recovery_candidates as materialized \(|,\s*recovery_identities as materialized \(/g;
	const witness = 'select admitted.*,case when admitted.control_scope is null';
	assert.ok(firstPassSql.startsWith('ready_scopes as materialized ('));
	const ages = firstPassSql.indexOf(ageStart);
	const recovery = [...firstPassSql.matchAll(recoveryStart)];
	assert.ok(ages > 0 && recovery.length >= 1 && recovery[0].index > ages);
	const legacy = firstPassSql.slice(0,recovery[0].index);
	const sharedTail = firstPassSql.slice(recovery[0].index);
	assert.equal(legacy.split(witness).length,2);
	const indexed = legacy.slice(ages).replace(witness,
		`select admitted.*, admitted."archiveUrlIdentity" is distinct from scope."archiveUrlIdentity" as mismatched,
		case when admitted.control_scope is null`);
	return `indexed_fresh as materialized (
		${domains}, ${scopes}${indexed}
		select fresh_admission.*,false as exceeded from fresh_admission
		union all select ${columns.slice(0,-1).map(()=> 'null').join(',')},false,null::timestamptz,true from discovery_budget where exceeded
	), fresh_fallback as materialized (
		select exists(select 1 from indexed_fresh where mismatched or exceeded) as needed
	), legacy_fresh as materialized (
		with ${legacy}
		select * from fresh_admission where (select needed from fresh_fallback)
	), fresh_admission as materialized (
		select ${columns.map(column=>`indexed.${column}`).join(',')}
		from indexed_fresh indexed where not (select needed from fresh_fallback)
		union all select * from legacy_fresh
	)${sharedTail}`;
}

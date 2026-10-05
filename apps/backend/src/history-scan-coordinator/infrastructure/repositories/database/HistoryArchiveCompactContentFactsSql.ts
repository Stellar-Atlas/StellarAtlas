// Compact rows are accepted only after the normal exact claim completion, and
// remain bound to the append-only per-root observation. Legacy rows are unchanged.
export const historyArchiveCompactContentFactsSql = `
create or replace function history_archive_compact_content_facts(
	facts jsonb, object_type text, source_url text, artifact_id uuid,
	source_object_id uuid, derivation_version integer, claim_attempt integer
) returns jsonb language sql immutable strict as $function$
	select jsonb_build_object(
		'content', facts->'content',
		'contentReference', jsonb_build_object(
			'artifactId', artifact_id, 'claimAttempt', claim_attempt,
			'contentRepresentation', 'uncompressed-xdr',
			'derivationVersion', derivation_version,
			'sourceObjectRemoteId', source_object_id
		),
		object_type || 'Category',
		((facts->(object_type || 'Category')) - 'ledgers') ||
		jsonb_build_object('sourceUrl', source_url, 'sharedSummary', (
			select jsonb_build_object(
				'firstLedger', min((entry->>'ledger')::bigint),
				'lastLedger', max((entry->>'ledger')::bigint),
				'ledgerCount', count(distinct (entry->>'ledger')::bigint)
			)
			from jsonb_array_elements(facts->(object_type || 'Category')->'ledgers') entry
		))
	)
$function$;

create or replace function validate_history_archive_content_observation()
returns trigger language plpgsql as $function$
declare
	artifact record;
	observed_object record;
	matching_facts boolean;
begin
	select object."objectType", object."objectKey", object."objectUrl",
		object."checkpointLedger", object.status, object.attempts,
		object."verificationFacts"
	into observed_object from history_archive_object_queue object
	where object."remoteId" = new."objectRemoteId" for key share;
	select stored.* into artifact from history_archive_content_artifact stored
	where stored.id = new."artifactId";
	if observed_object is null or artifact is null
		or observed_object.status <> 'verified'
		or observed_object.attempts <> new."claimAttempt" then
		raise exception using errcode = '55000',
			message = 'content observation is not an accepted verification';
	end if;
	if observed_object."verificationFacts" ? 'contentReference' then
		matching_facts := artifact."objectType" in ('ledger', 'transactions', 'results')
			and artifact."contentRepresentation" = 'uncompressed-xdr'
			and artifact."derivationVersion" = 1
			and observed_object."verificationFacts" = history_archive_compact_content_facts(
				artifact."verificationFacts", artifact."objectType", observed_object."objectUrl",
				artifact.id, artifact."sourceObjectRemoteId", artifact."derivationVersion", new."claimAttempt"
			)
			and exists (select 1 from history_archive_content_observation origin
				where origin."artifactId" = artifact.id
				and origin."objectRemoteId" = artifact."sourceObjectRemoteId"
				and origin."claimAttempt" = artifact."sourceClaimAttempt");
	else
		matching_facts := history_archive_content_source_neutral_facts(
			observed_object."objectType", observed_object."verificationFacts"
		) is not distinct from artifact."verificationFacts";
	end if;
	if observed_object."objectType" <> artifact."objectType"
		or observed_object."objectKey" <> artifact."objectKey"
		or observed_object."checkpointLedger" is distinct from artifact."checkpointLedger"
		or matching_facts is distinct from true then
		raise exception using errcode = '55000',
			message = 'content observation does not match its artifact';
	end if;
	return new;
end
$function$;

create or replace function history_archive_category_ledgers(
	object_id uuid, claim_attempt integer, object_type text, object_key text,
	checkpoint integer, source_url text, facts jsonb
) returns jsonb language plpgsql stable as $function$
declare resolved jsonb;
begin
	if not coalesce(facts ? 'contentReference', false) then
		return facts->(object_type || 'Category')->'ledgers';
	end if;
	-- Both indexed observation identity and immutable artifact identity are exact.
	-- Missing or corrupt references return NULL, never an apparent empty category.
	select artifact."verificationFacts"->(object_type || 'Category')->'ledgers'
	into resolved
	from history_archive_content_observation observation
	join history_archive_content_artifact artifact on artifact.id = observation."artifactId"
	where observation."objectRemoteId" = object_id
		and observation."claimAttempt" = claim_attempt
		and artifact."objectType" = object_type and artifact."objectKey" = object_key
		and artifact."checkpointLedger" is not distinct from checkpoint
		and artifact."contentDigest" = facts#>>'{content,digest}'
		and artifact."contentRepresentation" = 'uncompressed-xdr'
		and artifact."derivationVersion" = 1
		and facts = history_archive_compact_content_facts(
			artifact."verificationFacts", object_type, source_url, artifact.id,
			artifact."sourceObjectRemoteId", artifact."derivationVersion", claim_attempt
		)
		and exists (select 1 from history_archive_content_observation origin
			where origin."artifactId" = artifact.id
			and origin."objectRemoteId" = artifact."sourceObjectRemoteId"
			and origin."claimAttempt" = artifact."sourceClaimAttempt");
	return resolved;
end
$function$;
`;

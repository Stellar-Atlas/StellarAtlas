// A derived cache, never a new proof authority. Its only writer derives the
// complete template from the immutable artifact; no caller summary is trusted.
export function historyArchiveDbCompactTemplateSchemaSql(
	tablespace: string
): string {
	if (!/^[a-z][a-z0-9_]{0,62}$/.test(tablespace))
		throw new Error('Invalid compact template tablespace');
	return `create table if not exists public.history_archive_content_compact_template (
		"artifactId" uuid not null references public.history_archive_content_artifact(id) on delete restrict,
		template jsonb not null,
		"createdAt" timestamptz not null default now(),
		primary key ("artifactId") using index tablespace "${tablespace}",
		check (octet_length(template::text) <= 65536)
	) tablespace "${tablespace}";
	create or replace function public.derive_history_archive_content_compact_template()
	returns trigger language plpgsql as $function$
	declare artifact record;
	begin
		-- A duplicate attempt cannot replace the stored value or rewalk its facts.
		if exists (select 1 from public.history_archive_content_compact_template
			where "artifactId" = new."artifactId") then return null; end if;
		select stored."objectType", stored."verificationFacts", stored."sourceObjectRemoteId",
			stored."sourceClaimAttempt", stored."derivationVersion", stored."contentRepresentation"
		into artifact from public.history_archive_content_artifact stored where stored.id=new."artifactId";
		if artifact is null or artifact."objectType" not in ('ledger','transactions','results')
			or artifact."derivationVersion" <> 1 or artifact."contentRepresentation" <> 'uncompressed-xdr'
			or not exists (select 1 from public.history_archive_content_observation origin
				where origin."artifactId"=new."artifactId"
				and origin."objectRemoteId"=artifact."sourceObjectRemoteId"
				and origin."claimAttempt"=artifact."sourceClaimAttempt") then
			raise exception using errcode='55000', message='Compact template has no verified immutable origin';
		end if;
		new.template := public.history_archive_compact_content_facts(artifact."verificationFacts",
			artifact."objectType", '', new."artifactId", artifact."sourceObjectRemoteId",
			artifact."derivationVersion", 0);
		new."createdAt" := now();
		return new;
	end $function$;
	drop trigger if exists "TR_history_archive_content_compact_template_derive" on public.history_archive_content_compact_template;
	create trigger "TR_history_archive_content_compact_template_derive" before insert
		on public.history_archive_content_compact_template for each row execute function public.derive_history_archive_content_compact_template();
	drop trigger if exists "TR_history_archive_content_compact_template_immutable" on public.history_archive_content_compact_template;
	create trigger "TR_history_archive_content_compact_template_immutable" before update or delete
		on public.history_archive_content_compact_template for each statement execute function public.reject_history_archive_content_evidence_mutation();
	drop trigger if exists "TR_history_archive_content_compact_template_no_truncate" on public.history_archive_content_compact_template;
	create trigger "TR_history_archive_content_compact_template_no_truncate" before truncate
		on public.history_archive_content_compact_template for each statement execute function public.reject_history_archive_content_evidence_mutation();
	create or replace function public.history_archive_bound_compact_template(
		artifact_id uuid, object_type text, source_url text, claim_attempt integer
	) returns jsonb language sql stable strict as $function$
		select jsonb_set(jsonb_set(template, array[object_type || 'Category','sourceUrl'], to_jsonb(source_url)),
			'{contentReference,claimAttempt}', to_jsonb(claim_attempt))
		from public.history_archive_content_compact_template where "artifactId"=artifact_id
	$function$;`;
}

export const historyArchiveDbCompactTemplateValidationSql = `
create or replace function public.validate_history_archive_content_observation()
returns trigger language plpgsql as $function$
declare artifact record; observed_object record; matching_facts boolean; expected_facts jsonb;
begin
	select object."objectType", object."objectKey", object."objectUrl", object."checkpointLedger",
		object.status, object.attempts, object."verificationFacts"
	into observed_object from public.history_archive_object_queue object
	where object."remoteId"=new."objectRemoteId" for key share;
	-- Explicit small columns: a compact hit never accesses the artifact's TOAST.
	select stored.id, stored."objectType", stored."objectKey", stored."checkpointLedger",
		stored."contentRepresentation", stored."derivationVersion", stored."sourceObjectRemoteId", stored."sourceClaimAttempt"
	into artifact from public.history_archive_content_artifact stored where stored.id=new."artifactId";
	if observed_object is null or artifact is null or observed_object.status <> 'verified'
		or observed_object.attempts <> new."claimAttempt" then
		raise exception using errcode='55000', message='content observation is not an accepted verification';
	end if;
	if observed_object."verificationFacts" ? 'contentReference' then
		expected_facts := public.history_archive_bound_compact_template(artifact.id,
			artifact."objectType", observed_object."objectUrl", new."claimAttempt");
		if expected_facts is null then
			-- Fail-open only for cache availability: the original full proof check
			-- still runs, and this validator never inserts or locks a cache row.
			select public.history_archive_compact_content_facts(stored."verificationFacts", artifact."objectType",
				observed_object."objectUrl", artifact.id, artifact."sourceObjectRemoteId", artifact."derivationVersion", new."claimAttempt")
			into expected_facts from public.history_archive_content_artifact stored where stored.id=artifact.id;
		end if;
		matching_facts := artifact."objectType" in ('ledger','transactions','results')
			and artifact."contentRepresentation"='uncompressed-xdr' and artifact."derivationVersion"=1
			and observed_object."verificationFacts"=expected_facts
			and exists (select 1 from public.history_archive_content_observation origin
				where origin."artifactId"=artifact.id and origin."objectRemoteId"=artifact."sourceObjectRemoteId"
				and origin."claimAttempt"=artifact."sourceClaimAttempt");
	else
		select public.history_archive_content_source_neutral_facts(observed_object."objectType",
			observed_object."verificationFacts") is not distinct from stored."verificationFacts"
		into matching_facts from public.history_archive_content_artifact stored where stored.id=artifact.id;
	end if;
	if observed_object."objectType" <> artifact."objectType" or observed_object."objectKey" <> artifact."objectKey"
		or observed_object."checkpointLedger" is distinct from artifact."checkpointLedger" or matching_facts is distinct from true then
		raise exception using errcode='55000', message='content observation does not match its artifact';
	end if;
	return new;
end $function$;
`;

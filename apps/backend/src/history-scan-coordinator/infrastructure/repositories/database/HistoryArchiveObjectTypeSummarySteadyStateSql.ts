export const archiveObjectTypeSummarySteadyStateTriggerFunctionSql = `
	create or replace function refresh_history_archive_object_type_summary()
	returns trigger
	language plpgsql
	as $function$
	declare
		old_hash integer;
		new_hash integer;
		same_key boolean := false;
	begin
		if tg_op = 'UPDATE'
			and old.id = new.id
			and old."archiveUrlIdentity" = new."archiveUrlIdentity"
			and old."objectType" = new."objectType"
			and old.status = new.status
			and old."failureChannel" is not distinct from new."failureChannel"
		then
			return new;
		end if;

		if tg_op in ('DELETE', 'UPDATE') then
			old_hash := hashtext(
				old."archiveUrlIdentity" || chr(31) || old."objectType"
			);
		end if;
		if tg_op in ('INSERT', 'UPDATE') then
			new_hash := hashtext(
				new."archiveUrlIdentity" || chr(31) || new."objectType"
			);
		end if;

		if tg_op = 'UPDATE' then
			same_key := old."archiveUrlIdentity" = new."archiveUrlIdentity"
				and old."objectType" = new."objectType";
			if old_hash = new_hash then
				perform pg_advisory_xact_lock(1785080001, old_hash);
			else
				perform pg_advisory_xact_lock(
					1785080001,
					least(old_hash, new_hash)
				);
				perform pg_advisory_xact_lock(
					1785080001,
					greatest(old_hash, new_hash)
				);
			end if;
		elsif tg_op = 'DELETE' then
			perform pg_advisory_xact_lock(1785080001, old_hash);
		else
			perform pg_advisory_xact_lock(1785080001, new_hash);
		end if;

		if tg_op = 'UPDATE' and same_key then
			update history_archive_object_type_summary set
				"pendingObjects" = "pendingObjects"
					+ (new.status = 'pending')::integer
					- (old.status = 'pending')::integer,
				"scanningObjects" = "scanningObjects"
					+ (new.status = 'scanning')::integer
					- (old.status = 'scanning')::integer,
				"verifiedObjects" = "verifiedObjects"
					+ (new.status = 'verified')::integer
					- (old.status = 'verified')::integer,
				"remoteFailureObjects" = "remoteFailureObjects"
					+ coalesce((new.status = 'failed' and new."failureChannel"
						= 'archive_evidence'), false)::integer
					- coalesce((old.status = 'failed' and old."failureChannel"
						= 'archive_evidence'), false)::integer,
				"scannerIssueObjects" = "scannerIssueObjects"
					+ coalesce((new.status = 'failed' and new."failureChannel"
						= 'scanner_issue'), false)::integer
					- coalesce((old.status = 'failed' and old."failureChannel"
						= 'scanner_issue'), false)::integer,
				"updatedAt" = now()
			where "archiveUrlIdentity" = old."archiveUrlIdentity"
				and "objectType" = old."objectType";
			if not found then
				raise exception 'Archive object type summary row is missing';
			end if;
			return new;
		end if;

		if tg_op in ('DELETE', 'UPDATE') then
			update history_archive_object_type_summary set
				"totalObjects" = "totalObjects" - 1,
				"pendingObjects" = "pendingObjects"
					- (old.status = 'pending')::integer,
				"scanningObjects" = "scanningObjects"
					- (old.status = 'scanning')::integer,
				"verifiedObjects" = "verifiedObjects"
					- (old.status = 'verified')::integer,
				"remoteFailureObjects" = "remoteFailureObjects" - coalesce((
					old.status = 'failed'
					and old."failureChannel" = 'archive_evidence'
				), false)::integer,
				"scannerIssueObjects" = "scannerIssueObjects" - coalesce((
					old.status = 'failed'
					and old."failureChannel" = 'scanner_issue'
				), false)::integer,
				"updatedAt" = now()
			where "archiveUrlIdentity" = old."archiveUrlIdentity"
				and "objectType" = old."objectType";
			if not found then
				raise exception 'Archive object type summary row is missing';
			end if;

			delete from history_archive_object_type_summary
			where "archiveUrlIdentity" = old."archiveUrlIdentity"
				and "objectType" = old."objectType"
				and "totalObjects" = 0;
		end if;

		if tg_op in ('INSERT', 'UPDATE') then
			insert into history_archive_object_type_summary (
				"archiveUrlIdentity", "objectType", "totalObjects",
				"pendingObjects", "scanningObjects", "verifiedObjects",
				"remoteFailureObjects", "scannerIssueObjects", "updatedAt"
			) values (
				new."archiveUrlIdentity", new."objectType", 1,
				(new.status = 'pending')::integer,
				(new.status = 'scanning')::integer,
				(new.status = 'verified')::integer,
				coalesce((new.status = 'failed' and new."failureChannel"
					= 'archive_evidence'), false)::integer,
				coalesce((new.status = 'failed' and new."failureChannel"
					= 'scanner_issue'), false)::integer,
				now()
			)
			on conflict ("archiveUrlIdentity", "objectType") do update set
				"totalObjects" =
					history_archive_object_type_summary."totalObjects" + 1,
				"pendingObjects" =
					history_archive_object_type_summary."pendingObjects"
					+ excluded."pendingObjects",
				"scanningObjects" =
					history_archive_object_type_summary."scanningObjects"
					+ excluded."scanningObjects",
				"verifiedObjects" =
					history_archive_object_type_summary."verifiedObjects"
					+ excluded."verifiedObjects",
				"remoteFailureObjects" =
					history_archive_object_type_summary."remoteFailureObjects"
					+ excluded."remoteFailureObjects",
				"scannerIssueObjects" =
					history_archive_object_type_summary."scannerIssueObjects"
					+ excluded."scannerIssueObjects",
				"updatedAt" = now();
		end if;

		return case when tg_op = 'DELETE' then old else new end;
	end;
	$function$
`;

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveContentReuseMigration1785520000000 implements MigrationInterface {
	name = 'HistoryArchiveContentReuseMigration1785520000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table "history_archive_content_artifact" (
				id uuid primary key default gen_random_uuid(),
				"objectType" varchar(32) not null,
				"objectKey" text not null,
				"checkpointLedger" integer,
				"contentDigest" text not null,
				"contentRepresentation" varchar(32) not null,
				"derivationVersion" integer not null,
				"verificationFacts" jsonb not null,
				"sourceObjectRemoteId" uuid not null,
				"sourceClaimAttempt" integer not null,
				"createdAt" timestamptz not null default now(),
				constraint "CK_history_archive_content_artifact_type"
					check ("objectType" in ('ledger', 'transactions', 'results', 'scp')),
				constraint "CK_history_archive_content_artifact_digest"
					check ("contentDigest" ~ '^[0-9a-f]{64}$'),
				constraint "CK_history_archive_content_artifact_representation"
					check ("contentRepresentation" = 'uncompressed-xdr'),
				constraint "CK_history_archive_content_artifact_derivation"
					check ("derivationVersion" = 1),
				constraint "CK_history_archive_content_artifact_source_attempt"
					check ("sourceClaimAttempt" > 0),
				constraint "FK_history_archive_content_artifact_source"
					foreign key ("sourceObjectRemoteId")
					references "history_archive_object_queue" ("remoteId")
					on delete restrict,
				constraint "UQ_history_archive_content_artifact_identity"
					unique (
						"objectType", "objectKey", "contentDigest",
						"contentRepresentation", "derivationVersion"
					)
			);

			create table "history_archive_content_observation" (
				id bigserial primary key,
				"objectRemoteId" uuid not null,
				"artifactId" uuid not null,
				"claimAttempt" integer not null,
				"observedAt" timestamptz not null default now(),
				constraint "CK_history_archive_content_observation_attempt"
					check ("claimAttempt" > 0),
				constraint "FK_history_archive_content_observation_object"
					foreign key ("objectRemoteId")
					references "history_archive_object_queue" ("remoteId")
					on delete restrict,
				constraint "FK_history_archive_content_observation_artifact"
					foreign key ("artifactId")
					references "history_archive_content_artifact" (id)
					on delete restrict,
				constraint "UQ_history_archive_content_observation_attempt"
					unique ("objectRemoteId", "claimAttempt")
			);

			create index "IDX_history_archive_content_artifact_digest"
			on "history_archive_content_artifact" (
				"objectType", "contentDigest", "contentRepresentation",
				"derivationVersion"
			);

			create index "IDX_history_archive_content_observation_artifact"
			on "history_archive_content_observation" ("artifactId");

			create function history_archive_content_source_neutral_facts(
				object_type text,
				facts jsonb
			) returns jsonb language sql immutable strict as $function$
				select case object_type
					when 'ledger' then facts #- '{ledgerCategory,sourceUrl}'
					when 'transactions' then
						facts #- '{transactionsCategory,sourceUrl}'
					when 'results' then facts #- '{resultsCategory,sourceUrl}'
					when 'scp' then facts #- '{scpCategory,sourceUrl}'
					else null
				end
			$function$;

			create function validate_history_archive_content_artifact()
			returns trigger language plpgsql as $function$
			declare
				category_key text;
				source_object record;
			begin
				select object."objectType", object."objectKey",
					object."checkpointLedger", object.status, object.attempts,
					object."verificationFacts"
				into source_object
				from "history_archive_object_queue" object
				where object."remoteId" = new."sourceObjectRemoteId"
				for key share;

				if not found
					or source_object.status <> 'verified'
					or source_object.attempts <> new."sourceClaimAttempt"
				then
					raise exception using errcode = '55000',
						message = 'content artifact source is not an accepted verification';
				end if;
				if source_object."objectType" <> new."objectType"
					or source_object."objectKey" <> new."objectKey"
					or source_object."checkpointLedger" is distinct from
						new."checkpointLedger"
				then
					raise exception using errcode = '55000',
						message = 'content artifact identity does not match its source';
				end if;

				category_key := case new."objectType"
					when 'ledger' then 'ledgerCategory'
					when 'transactions' then 'transactionsCategory'
					when 'results' then 'resultsCategory'
					when 'scp' then 'scpCategory'
				end;
				if category_key is null
					or not (new."verificationFacts" ? category_key)
					or new."verificationFacts" #>> '{content,algorithm}' <> 'sha256'
					or new."verificationFacts" #>> '{content,digest}' <>
						new."contentDigest"
					or new."verificationFacts" #>> '{content,representation}' <>
						new."contentRepresentation"
					or history_archive_content_source_neutral_facts(
						source_object."objectType",
						source_object."verificationFacts"
					) is distinct from new."verificationFacts"
				then
					raise exception using errcode = '55000',
						message = 'content artifact facts do not match its verified source';
				end if;
				return new;
			end
			$function$;

			create function validate_history_archive_content_observation()
			returns trigger language plpgsql as $function$
			declare
				artifact record;
				observed_object record;
			begin
				select object."objectType", object."objectKey",
					object."checkpointLedger", object.status, object.attempts,
					object."verificationFacts"
				into observed_object
				from "history_archive_object_queue" object
				where object."remoteId" = new."objectRemoteId"
				for key share;

				select stored."objectType", stored."objectKey",
					stored."checkpointLedger", stored."verificationFacts"
				into artifact
				from "history_archive_content_artifact" stored
				where stored.id = new."artifactId";

				if observed_object is null
					or artifact is null
					or observed_object.status <> 'verified'
					or observed_object.attempts <> new."claimAttempt"
				then
					raise exception using errcode = '55000',
						message = 'content observation is not an accepted verification';
				end if;
				if observed_object."objectType" <> artifact."objectType"
					or observed_object."objectKey" <> artifact."objectKey"
					or observed_object."checkpointLedger" is distinct from
						artifact."checkpointLedger"
					or history_archive_content_source_neutral_facts(
						observed_object."objectType",
						observed_object."verificationFacts"
					) is distinct from artifact."verificationFacts"
				then
					raise exception using errcode = '55000',
						message = 'content observation does not match its artifact';
				end if;
				return new;
			end
			$function$;

			create trigger "TR_history_archive_content_artifact_validate"
			before insert on "history_archive_content_artifact"
			for each row execute function
				validate_history_archive_content_artifact();

			create trigger "TR_history_archive_content_observation_validate"
			before insert on "history_archive_content_observation"
			for each row execute function
				validate_history_archive_content_observation();

			create function reject_history_archive_content_evidence_mutation()
			returns trigger language plpgsql as $function$
			begin
				raise exception using
					errcode = '55000',
					message = 'history archive content evidence is append-only';
			end
			$function$;

			create trigger "TR_history_archive_content_artifact_immutable"
			before update or delete on "history_archive_content_artifact"
			for each statement execute function
				reject_history_archive_content_evidence_mutation();

			create trigger "TR_history_archive_content_observation_immutable"
			before update or delete on "history_archive_content_observation"
			for each statement execute function
				reject_history_archive_content_evidence_mutation();

			create trigger "TR_history_archive_content_artifact_no_truncate"
			before truncate on "history_archive_content_artifact"
			for each statement execute function
				reject_history_archive_content_evidence_mutation();

			create trigger "TR_history_archive_content_observation_no_truncate"
			before truncate on "history_archive_content_observation"
			for each statement execute function
				reject_history_archive_content_evidence_mutation();
		`);
	}

	async down(): Promise<void> {
		throw new Error(
			'History archive content evidence migration is forward-only'
		);
	}
}

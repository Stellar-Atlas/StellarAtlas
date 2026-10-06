// Keep inactive claims distinct from invalid artifacts on an active claim.
// This is one bounded reference lookup for the whole completion batch. It does
// not accept a replay or change evidence; the final completion fence and the
// use case's existing terminal-result handling remain authoritative.
export const resolveReusableCompletionsSql = `
        with input as materialized (
                select *
                from jsonb_to_recordset($1::jsonb) as input(
                        "remoteId" uuid,
                        "executionId" uuid,
                        "claimAttempt" integer,
                        "artifactId" uuid,
                        "sourceObjectRemoteId" uuid,
                        "contentDigest" text,
                        "contentRepresentation" text,
                        "derivationVersion" integer,
                        "omitVerificationFacts" boolean
                )
        )
        select input."remoteId",
                ready."objectRemoteId" is not null as "activeClaim",
                artifact.id as "artifactId",
                case when input."omitVerificationFacts" is true then null
                        else artifact."verificationFacts" end as "verificationFacts",
                object."objectType",
                object."objectUrl"
        from input
        join "history_archive_object_queue" object
                on object."remoteId" = input."remoteId"
        left join "history_archive_object_ready" ready
                on ready."objectRemoteId" = object."remoteId"
                and ready."dispatchToken" = input."executionId"
                and ready."claimAttempt" = input."claimAttempt"
                and ready."publishedAt" is not null
        left join "history_archive_content_artifact" artifact
                on ready."objectRemoteId" is not null
                and artifact.id = input."artifactId"
                and artifact."sourceObjectRemoteId" =
                        input."sourceObjectRemoteId"
                and artifact."objectType" = object."objectType"
                and artifact."objectKey" = object."objectKey"
                and artifact."checkpointLedger" is not distinct from
                        object."checkpointLedger"
                and artifact."contentDigest" = input."contentDigest"
                and artifact."contentRepresentation" =
                        input."contentRepresentation"
                and artifact."derivationVersion" =
                        input."derivationVersion"
                and exists (
                        select 1
                        from "history_archive_content_observation" observation
                        where observation."artifactId" = artifact.id
                                and observation."objectRemoteId" =
                                        artifact."sourceObjectRemoteId"
                                and observation."claimAttempt" =
                                        artifact."sourceClaimAttempt"
                )
`;

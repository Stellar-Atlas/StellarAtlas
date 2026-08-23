import type { EntityManager } from 'typeorm';
import {
	historyArchiveContentDerivationVersionV1,
	type HistoryArchiveContentReuseRequestV1,
	type HistoryArchiveContentReuseV1,
	type HistoryArchiveReusableContentV1
} from 'shared';
import type {
	HistoryArchiveObjectType,
	HistoryArchiveObjectVerificationFacts
} from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectProgressUpdate } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';

interface ArtifactRow {
	readonly artifactId: string;
	readonly objectUrl: string;
	readonly sourceObjectRemoteId: string;
	readonly verificationFacts: unknown;
}

interface CompletionObjectRow {
	readonly attempts: number | string;
	readonly checkpointLedger: number | string | null;
	readonly objectKey: string;
	readonly objectType: HistoryArchiveObjectType;
	readonly objectUrl: string;
	readonly remoteId: string;
	readonly verificationFacts: unknown;
}

export interface PreparedContentCompletion {
	readonly progress: HistoryArchiveObjectProgressUpdate;
	readonly reuse: HistoryArchiveContentReuseV1 | null;
}

export interface HistoryArchiveContentCompletionUpdate {
	readonly remoteId: string;
	readonly progress: HistoryArchiveObjectProgressUpdate;
}

export interface PreparedHistoryArchiveContentCompletion {
	readonly remoteId: string;
	readonly prepared: PreparedContentCompletion;
}

const digestPattern = /^[0-9a-f]{64}$/;
const reusableTypes = new Set<HistoryArchiveObjectType>([
	'ledger',
	'transactions',
	'results',
	'scp'
]);

export async function findReusableHistoryArchiveContent(
	manager: EntityManager,
	request: HistoryArchiveContentReuseRequestV1
): Promise<HistoryArchiveReusableContentV1 | null> {
	const rows = (await manager.query(findReusableContentSql, [
		request.remoteId,
		request.executionId,
		request.claimAttempt,
		request.objectType,
		request.objectKey,
		request.contentDigest,
		request.contentRepresentation,
		request.derivationVersion
	])) as readonly ArtifactRow[];
	const row = rows[0];
	if (row === undefined) return null;
	const facts = rehydrateSourceUrl(
		request.objectType as HistoryArchiveObjectType,
		row.verificationFacts,
		row.objectUrl
	);
	return {
		artifactId: row.artifactId,
		contentDigest: request.contentDigest,
		contentRepresentation: request.contentRepresentation,
		derivationVersion: historyArchiveContentDerivationVersionV1,
		sourceObjectRemoteId: row.sourceObjectRemoteId,
		verificationFacts: facts
	};
}

export async function prepareHistoryArchiveContentCompletion(
	manager: EntityManager,
	remoteId: string,
	progress: HistoryArchiveObjectProgressUpdate
): Promise<PreparedContentCompletion> {
	if (progress.contentReuse === undefined) {
		return { progress, reuse: null };
	}
	if (progress.scheduler !== 'broker' || progress.executionId === undefined) {
		throw new Error('Content reuse requires an exact broker claim');
	}
	const reuse = progress.contentReuse;
	const rows = (await manager.query(resolveReusableCompletionSql, [
		remoteId,
		progress.executionId,
		progress.claimAttempt,
		reuse.artifactId,
		reuse.sourceObjectRemoteId,
		reuse.contentDigest,
		reuse.contentRepresentation,
		reuse.derivationVersion
	])) as readonly (ArtifactRow & {
		readonly objectType: HistoryArchiveObjectType;
		readonly objectUrl: string;
	})[];
	const row = rows[0];
	if (row === undefined) {
		throw new Error('Content reuse artifact does not match the active claim');
	}
	return {
		progress: {
			...progress,
			verificationFacts: rehydrateSourceUrl(
				row.objectType,
				row.verificationFacts,
				row.objectUrl
			)
		},
		reuse
	};
}

export async function prepareHistoryArchiveContentCompletions(
	manager: EntityManager,
	updates: readonly HistoryArchiveContentCompletionUpdate[]
): Promise<readonly PreparedHistoryArchiveContentCompletion[]> {
	const reuseUpdates = updates.filter(
		(update) => update.progress.contentReuse !== undefined
	);
	for (const update of reuseUpdates) {
		if (
			update.progress.scheduler !== 'broker' ||
			update.progress.executionId === undefined
		) {
			throw new Error('Content reuse requires an exact broker claim');
		}
	}
	const rows =
		reuseUpdates.length === 0
			? []
			: ((await manager.query(resolveReusableCompletionsSql, [
					JSON.stringify(
						reuseUpdates.map(({ progress, remoteId }) => ({
							artifactId: progress.contentReuse!.artifactId,
							claimAttempt: progress.claimAttempt,
							contentDigest: progress.contentReuse!.contentDigest,
							contentRepresentation:
								progress.contentReuse!.contentRepresentation,
							derivationVersion: progress.contentReuse!.derivationVersion,
							executionId: progress.executionId!,
							remoteId,
							sourceObjectRemoteId: progress.contentReuse!.sourceObjectRemoteId
						}))
					)
				])) as readonly (ArtifactRow & {
					readonly objectType: HistoryArchiveObjectType;
					readonly remoteId: string;
				})[]);
	const rowsByRemoteId = new Map(rows.map((row) => [row.remoteId, row]));

	return updates.map(({ progress, remoteId }) => {
		const reuse = progress.contentReuse;
		if (reuse === undefined) {
			return { prepared: { progress, reuse: null }, remoteId };
		}
		const row = rowsByRemoteId.get(remoteId);
		if (row === undefined) {
			throw new Error('Content reuse artifact does not match the active claim');
		}
		return {
			prepared: {
				progress: {
					...progress,
					verificationFacts: rehydrateSourceUrl(
						row.objectType,
						row.verificationFacts,
						row.objectUrl
					)
				},
				reuse
			},
			remoteId
		};
	});
}

export async function recordHistoryArchiveContentEvidenceBatch(
	manager: EntityManager,
	updates: readonly PreparedHistoryArchiveContentCompletion[]
): Promise<void> {
	const reuseUpdates = updates.filter(
		(update) => update.prepared.reuse !== null
	);
	if (reuseUpdates.length > 0) {
		await manager.query(insertReuseObservationsSql, [
			JSON.stringify(
				reuseUpdates.map(({ prepared, remoteId }) => ({
					artifactId: prepared.reuse!.artifactId,
					claimAttempt: prepared.progress.claimAttempt,
					remoteId
				}))
			)
		]);
	}

	const freshUpdates = updates.filter(
		(update) =>
			update.prepared.reuse === null &&
			categoryObjectType(update.prepared.progress.verificationFacts) !== null
	);
	if (freshUpdates.length === 0) return;

	const objects = (await manager.query(completionObjectsBatchSql, [
		JSON.stringify(
			freshUpdates.map(({ prepared, remoteId }) => ({
				claimAttempt: prepared.progress.claimAttempt,
				remoteId
			}))
		)
	])) as readonly CompletionObjectRow[];
	const freshArtifacts = objects.flatMap((object) => {
		if (!reusableTypes.has(object.objectType)) return [];
		const facts = sourceNeutralFacts(
			object.objectType,
			object.verificationFacts,
			object.objectUrl
		);
		const content = requireRecord(facts.content, 'content');
		const digest = requireDigest(content.digest);
		if (
			content.algorithm !== 'sha256' ||
			content.representation !== 'uncompressed-xdr'
		) {
			throw new Error('Category content facts are not uncompressed SHA-256');
		}
		return [
			{
				checkpointLedger: toNullableInteger(object.checkpointLedger),
				claimAttempt: toPositiveInteger(object.attempts, 'attempts'),
				contentDigest: digest,
				derivationVersion: historyArchiveContentDerivationVersionV1,
				objectKey: object.objectKey,
				objectType: object.objectType,
				remoteId: object.remoteId,
				verificationFacts: facts
			}
		];
	});
	if (freshArtifacts.length === 0) return;
	await manager.query(recordFreshContentEvidenceBatchSql, [
		JSON.stringify(freshArtifacts)
	]);
}

export async function recordHistoryArchiveContentEvidence(
	manager: EntityManager,
	remoteId: string,
	prepared: PreparedContentCompletion
): Promise<void> {
	if (prepared.reuse !== null) {
		await insertObservation(
			manager,
			remoteId,
			prepared.reuse.artifactId,
			prepared.progress.claimAttempt
		);
		return;
	}

	if (categoryObjectType(prepared.progress.verificationFacts) === null) {
		return;
	}
	const rows = (await manager.query(
		`select "objectType", "objectKey", "checkpointLedger", "objectUrl",
				attempts, "verificationFacts"
		 from "history_archive_object_queue"
		 where "remoteId" = $1::uuid and status = 'verified'
			and attempts = $2`,
		[remoteId, prepared.progress.claimAttempt]
	)) as readonly CompletionObjectRow[];
	const object = rows[0];
	if (object === undefined || !reusableTypes.has(object.objectType)) return;

	const facts = sourceNeutralFacts(
		object.objectType,
		object.verificationFacts,
		object.objectUrl
	);
	const content = requireRecord(facts.content, 'content');
	const digest = requireDigest(content.digest);
	if (
		content.algorithm !== 'sha256' ||
		content.representation !== 'uncompressed-xdr'
	) {
		throw new Error('Category content facts are not uncompressed SHA-256');
	}
	let [artifact] = (await manager.query(
		`with inserted as (
			insert into "history_archive_content_artifact" (
				"objectType", "objectKey", "checkpointLedger",
				"contentDigest", "contentRepresentation", "derivationVersion",
				"verificationFacts", "sourceObjectRemoteId", "sourceClaimAttempt"
			) values ($1, $2, $3, $4, 'uncompressed-xdr', $5, $6, $7::uuid, $8)
			on conflict (
				"objectType", "objectKey", "contentDigest",
				"contentRepresentation", "derivationVersion"
			) do nothing
			returning id
		)
		select id from inserted
		union all
		select id from "history_archive_content_artifact"
		where "objectType" = $1 and "objectKey" = $2
			and "contentDigest" = $4
			and "contentRepresentation" = 'uncompressed-xdr'
			and "derivationVersion" = $5
		limit 1`,
		[
			object.objectType,
			object.objectKey,
			toNullableInteger(object.checkpointLedger),
			digest,
			historyArchiveContentDerivationVersionV1,
			facts,
			remoteId,
			toPositiveInteger(object.attempts, 'attempts')
		]
	)) as readonly { readonly id: string }[];
	if (artifact === undefined) {
		// A concurrent winner can commit after this statement snapshot was
		// taken. A second statement gets a fresh READ COMMITTED snapshot.
		[artifact] = (await manager.query(
			`select id from "history_archive_content_artifact"
			 where "objectType" = $1 and "objectKey" = $2
				and "contentDigest" = $3
				and "contentRepresentation" = 'uncompressed-xdr'
				and "derivationVersion" = $4
			 limit 1`,
			[
				object.objectType,
				object.objectKey,
				digest,
				historyArchiveContentDerivationVersionV1
			]
		)) as readonly { readonly id: string }[];
	}
	if (artifact === undefined)
		throw new Error('Content artifact was not recorded');
	await insertObservation(
		manager,
		remoteId,
		artifact.id,
		prepared.progress.claimAttempt
	);
}

async function insertObservation(
	manager: EntityManager,
	remoteId: string,
	artifactId: string,
	claimAttempt: number
): Promise<void> {
	await manager.query(
		`insert into "history_archive_content_observation" (
			"objectRemoteId", "artifactId", "claimAttempt"
		 ) values ($1::uuid, $2::uuid, $3)
		 on conflict ("objectRemoteId", "claimAttempt") do nothing`,
		[remoteId, artifactId, claimAttempt]
	);
}

function categoryObjectType(
	facts: HistoryArchiveObjectVerificationFacts | null | undefined
): HistoryArchiveObjectType | null {
	if (facts?.ledgerCategory !== undefined) return 'ledger';
	if (facts?.transactionsCategory !== undefined) return 'transactions';
	if (facts?.resultsCategory !== undefined) return 'results';
	if (facts?.scpCategory !== undefined) return 'scp';
	return null;
}

function sourceNeutralFacts(
	objectType: HistoryArchiveObjectType,
	value: unknown,
	expectedSourceUrl: string
): HistoryArchiveObjectVerificationFacts {
	const facts = requireRecord(value, 'verificationFacts');
	const categoryKey = categoryKeyForObjectType(objectType);
	if (categoryKey === null) throw new Error('Unsupported reusable object type');
	const category = requireRecord(facts[categoryKey], categoryKey);
	if (category.sourceUrl !== expectedSourceUrl) {
		throw new Error('Category source URL does not match the verified object');
	}
	if (
		!Number.isSafeInteger(category.entryCount) ||
		Number(category.entryCount) < 0
	) {
		throw new Error('Category entry count is invalid');
	}
	if (
		objectType !== 'scp' &&
		(!Array.isArray(category.ledgers) ||
			category.ledgers.length !== Number(category.entryCount))
	) {
		throw new Error('Category ledger facts do not match entry count');
	}
	const { sourceUrl: _sourceUrl, ...sourceNeutralCategory } = category;
	return {
		content: requireRecord(facts.content, 'content') as unknown as NonNullable<
			HistoryArchiveObjectVerificationFacts['content']
		>,
		[categoryKey]: sourceNeutralCategory
	};
}

function rehydrateSourceUrl(
	objectType: HistoryArchiveObjectType,
	value: unknown,
	sourceUrl: string
): HistoryArchiveObjectVerificationFacts {
	const facts = requireRecord(value, 'verificationFacts');
	const categoryKey = categoryKeyForObjectType(objectType);
	if (categoryKey === null) throw new Error('Unsupported reusable object type');
	const category = requireRecord(facts[categoryKey], categoryKey);
	return {
		...facts,
		[categoryKey]: { ...category, sourceUrl }
	} as HistoryArchiveObjectVerificationFacts;
}

function categoryKeyForObjectType(
	objectType: HistoryArchiveObjectType
):
	| 'ledgerCategory'
	| 'transactionsCategory'
	| 'resultsCategory'
	| 'scpCategory'
	| null {
	switch (objectType) {
		case 'ledger':
			return 'ledgerCategory';
		case 'transactions':
			return 'transactionsCategory';
		case 'results':
			return 'resultsCategory';
		case 'scp':
			return 'scpCategory';
		default:
			return null;
	}
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	throw new Error(`${field} must be an object`);
}

function requireDigest(value: unknown): string {
	if (typeof value === 'string' && digestPattern.test(value)) return value;
	throw new Error('Content digest is invalid');
}

function toPositiveInteger(value: number | string, field: string): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
	throw new Error(`${field} must be a positive integer`);
}

function toNullableInteger(value: number | string | null): number | null {
	if (value === null) return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
	throw new Error('checkpointLedger must be a non-negative integer or null');
}

const findReusableContentSql = `
	with claim as materialized (
		select object."objectUrl"
		from "history_archive_object_queue" object
		join "history_archive_object_ready" ready
			on ready."objectRemoteId" = object."remoteId"
		where object."remoteId" = $1::uuid
			and ready."dispatchToken" = $2::uuid
			and ready."claimAttempt" = $3
			and ready."publishedAt" is not null
			and object."objectType" = $4
			and object."objectKey" = $5
	)
	select artifact.id as "artifactId",
		artifact."sourceObjectRemoteId", artifact."verificationFacts",
		claim."objectUrl"
	from claim
	join "history_archive_content_artifact" artifact
		on artifact."objectType" = $4
		and artifact."objectKey" = $5
		and artifact."contentDigest" = $6
		and artifact."contentRepresentation" = $7
		and artifact."derivationVersion" = $8
	where exists (
		select 1 from "history_archive_content_observation" observation
		where observation."artifactId" = artifact.id
			and observation."objectRemoteId" = artifact."sourceObjectRemoteId"
			and observation."claimAttempt" = artifact."sourceClaimAttempt"
	)
	order by artifact."createdAt", artifact.id
	limit 1
`;

const resolveReusableCompletionsSql = `
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
                        "derivationVersion" integer
                )
        )
        select input."remoteId",
                artifact.id as "artifactId",
                artifact."sourceObjectRemoteId",
                artifact."verificationFacts",
                object."objectType",
                object."objectUrl"
        from input
        join "history_archive_object_queue" object
                on object."remoteId" = input."remoteId"
        join "history_archive_object_ready" ready
                on ready."objectRemoteId" = object."remoteId"
                and ready."dispatchToken" = input."executionId"
                and ready."claimAttempt" = input."claimAttempt"
                and ready."publishedAt" is not null
        join "history_archive_content_artifact" artifact
                on artifact.id = input."artifactId"
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
        where exists (
                select 1
                from "history_archive_content_observation" observation
                where observation."artifactId" = artifact.id
                        and observation."objectRemoteId" =
                                artifact."sourceObjectRemoteId"
                        and observation."claimAttempt" =
                                artifact."sourceClaimAttempt"
        )
`;

const completionObjectsBatchSql = `
        with input as materialized (
                select *
                from jsonb_to_recordset($1::jsonb) as input(
                        "remoteId" uuid,
                        "claimAttempt" integer
                )
        )
        select object."remoteId", object."objectType", object."objectKey",
                object."checkpointLedger", object."objectUrl",
                object.attempts, object."verificationFacts"
        from input
        join "history_archive_object_queue" object
                on object."remoteId" = input."remoteId"
                and object.status = 'verified'
                and object.attempts = input."claimAttempt"
`;

const insertReuseObservationsSql = `
        with input as materialized (
                select *
                from jsonb_to_recordset($1::jsonb) as input(
                        "remoteId" uuid,
                        "artifactId" uuid,
                        "claimAttempt" integer
                )
        )
        insert into "history_archive_content_observation" (
                "objectRemoteId", "artifactId", "claimAttempt"
        )
        select input."remoteId", input."artifactId", input."claimAttempt"
        from input
        on conflict ("objectRemoteId", "claimAttempt") do nothing
`;

const recordFreshContentEvidenceBatchSql = `
        with input as materialized (
                select *
                from jsonb_to_recordset($1::jsonb) as input(
                        "remoteId" uuid,
                        "objectType" text,
                        "objectKey" text,
                        "checkpointLedger" integer,
                        "contentDigest" text,
                        "derivationVersion" integer,
                        "verificationFacts" jsonb,
                        "claimAttempt" integer
                )
        ), artifact_inputs as materialized (
                select distinct on (
                        input."objectType", input."objectKey",
                        input."contentDigest", input."derivationVersion"
                )
                        input.*
                from input
                order by input."objectType", input."objectKey",
                        input."contentDigest", input."derivationVersion",
                        input."remoteId"
        ), inserted as materialized (
                insert into "history_archive_content_artifact" (
                        "objectType", "objectKey", "checkpointLedger",
                        "contentDigest", "contentRepresentation",
                        "derivationVersion", "verificationFacts",
                        "sourceObjectRemoteId", "sourceClaimAttempt"
                )
                select artifact_input."objectType",
                        artifact_input."objectKey",
                        artifact_input."checkpointLedger",
                        artifact_input."contentDigest",
                        'uncompressed-xdr',
                        artifact_input."derivationVersion",
                        artifact_input."verificationFacts",
                        artifact_input."remoteId",
                        artifact_input."claimAttempt"
                from artifact_inputs artifact_input
                on conflict (
                        "objectType", "objectKey", "contentDigest",
                        "contentRepresentation", "derivationVersion"
                ) do nothing
                returning id, "objectType", "objectKey", "contentDigest",
                        "derivationVersion"
        ), resolved_artifacts as materialized (
                select inserted.id, inserted."objectType", inserted."objectKey",
                        inserted."contentDigest", inserted."derivationVersion"
                from inserted
                union all
                select artifact.id, artifact."objectType", artifact."objectKey",
                        artifact."contentDigest", artifact."derivationVersion"
                from artifact_inputs artifact_input
                join "history_archive_content_artifact" artifact
                        on artifact."objectType" = artifact_input."objectType"
                        and artifact."objectKey" = artifact_input."objectKey"
                        and artifact."contentDigest" =
                                artifact_input."contentDigest"
                        and artifact."contentRepresentation" =
                                'uncompressed-xdr'
                        and artifact."derivationVersion" =
                                artifact_input."derivationVersion"
                where not exists (
                        select 1
                        from inserted
                        where inserted."objectType" =
                                        artifact_input."objectType"
                                and inserted."objectKey" =
                                        artifact_input."objectKey"
                                and inserted."contentDigest" =
                                        artifact_input."contentDigest"
                                and inserted."derivationVersion" =
                                        artifact_input."derivationVersion"
                )
        )
        insert into "history_archive_content_observation" (
                "objectRemoteId", "artifactId", "claimAttempt"
        )
        select input."remoteId", artifact.id, input."claimAttempt"
        from input
        join resolved_artifacts artifact
                on artifact."objectType" = input."objectType"
                and artifact."objectKey" = input."objectKey"
                and artifact."contentDigest" = input."contentDigest"
                and artifact."derivationVersion" = input."derivationVersion"
        on conflict ("objectRemoteId", "claimAttempt") do nothing
`;

const resolveReusableCompletionSql = `
	select artifact.id as "artifactId", artifact."sourceObjectRemoteId",
		artifact."verificationFacts", object."objectType", object."objectUrl"
	from "history_archive_object_queue" object
	join "history_archive_object_ready" ready
		on ready."objectRemoteId" = object."remoteId"
	join "history_archive_content_artifact" artifact
		on artifact.id = $4::uuid
		and artifact."sourceObjectRemoteId" = $5::uuid
		and artifact."objectType" = object."objectType"
		and artifact."objectKey" = object."objectKey"
		and artifact."checkpointLedger" is not distinct from object."checkpointLedger"
		and artifact."contentDigest" = $6
		and artifact."contentRepresentation" = $7
		and artifact."derivationVersion" = $8
	where object."remoteId" = $1::uuid
		and ready."dispatchToken" = $2::uuid
		and ready."claimAttempt" = $3
		and ready."publishedAt" is not null
		and exists (
			select 1 from "history_archive_content_observation" observation
			where observation."artifactId" = artifact.id
				and observation."objectRemoteId" = artifact."sourceObjectRemoteId"
				and observation."claimAttempt" = artifact."sourceClaimAttempt"
		)
	limit 1
`;

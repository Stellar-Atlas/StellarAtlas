import type { EntityManager } from 'typeorm';
import {
	isHistoryArchiveReusableContentV2,
	type HistoryArchiveContentReuseRequestV1,
	type HistoryArchiveReusableContentResponse
} from 'shared';
import { findReusableHistoryArchiveContent } from './HistoryArchiveContentReuseWrite.js';

interface CompactLookupRow {
	readonly artifactId: string;
	readonly sourceObjectRemoteId: string;
	readonly objectUrl: string;
	readonly checkpointLedger: number;
	readonly template: unknown;
}

export async function lookupReusableHistoryArchiveContent(
	manager: EntityManager,
	request: HistoryArchiveContentReuseRequestV1
): Promise<HistoryArchiveReusableContentResponse | null> {
	if (
		request.responseFormat === 'compact-v2' &&
		request.objectType !== 'scp' &&
		process.env.HISTORY_ARCHIVE_DB_COMPACT_TEMPLATES_ENABLED === 'true'
	) {
		const rows = (await manager.query(findCompactReusableContentSql, [
			request.remoteId,
			request.executionId,
			request.claimAttempt,
			request.objectType,
			request.objectKey,
			request.contentDigest,
			request.contentRepresentation,
			request.derivationVersion
		])) as readonly CompactLookupRow[];
		const row = rows[0];
		if (row !== undefined && record(row.template)) {
			const category = row.template[`${request.objectType}Category`];
			if (record(category) && record(category.sharedSummary)) {
				const result = {
					format: 'compact-v2',
					artifactId: row.artifactId,
					sourceObjectRemoteId: row.sourceObjectRemoteId,
					contentDigest: request.contentDigest,
					contentRepresentation: request.contentRepresentation,
					derivationVersion: request.derivationVersion,
					binding: {
						remoteId: request.remoteId,
						executionId: request.executionId,
						claimAttempt: request.claimAttempt,
						objectType: request.objectType,
						objectKey: request.objectKey,
						checkpointLedger: row.checkpointLedger,
						sourceUrl: row.objectUrl
					},
					summary: {
						entryCount: category.entryCount,
						...category.sharedSummary,
						...(category.headerHashesVerified === undefined
							? {}
							: { headerHashesVerified: category.headerHashesVerified })
					}
				};
				if (isHistoryArchiveReusableContentV2(result)) return result;
			}
		}
	}
	// Old clients, disabled negotiation, cold/unsupported summary: exact old V1
	// behavior. Never pretend missing arrays are empty or a summary is a proof.
	return findReusableHistoryArchiveContent(manager, request);
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Deliberately never selects verificationFacts. Body digest comes from the
// scanner's actual download; every lookup still binds the active exact claim.
export const findCompactReusableContentSql = `
select artifact.id as "artifactId",artifact."sourceObjectRemoteId",object."objectUrl",
	object."checkpointLedger",cached.template
from public.history_archive_object_queue object
join public.history_archive_object_ready ready on ready."objectRemoteId"=object."remoteId"
	and ready."dispatchToken"=$2::uuid and ready."claimAttempt"=$3 and ready."publishedAt" is not null
join public.history_archive_content_artifact artifact on artifact."objectType"=$4 and artifact."objectKey"=$5
	and artifact."checkpointLedger" is not distinct from object."checkpointLedger"
	and artifact."contentDigest"=$6 and artifact."contentRepresentation"=$7 and artifact."derivationVersion"=$8
join public.history_archive_content_compact_template cached on cached."artifactId"=artifact.id
where object."remoteId"=$1::uuid and object."objectType"=$4 and object."objectKey"=$5
	and exists(select 1 from public.history_archive_content_observation origin where origin."artifactId"=artifact.id
		and origin."objectRemoteId"=artifact."sourceObjectRemoteId" and origin."claimAttempt"=artifact."sourceClaimAttempt")
order by artifact."createdAt",artifact.id limit 1;
`;

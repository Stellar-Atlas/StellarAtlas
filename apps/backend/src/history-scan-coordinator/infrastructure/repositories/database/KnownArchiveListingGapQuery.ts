import { isHistoryArchiveListingGapDTO } from 'history-scanner-dto';
import { historyArchiveListingGapAnchorSql } from './HistoryArchiveListingGapSql.js';
import {
	normalizeHistoryArchiveRootUrl,
	type KnownArchiveListingGapV1
} from 'shared';

export const knownArchiveListingGapSampleLimit = 20;

/** Only the sparse range table is counted; never the object/proof backlog. */
export function activeListingGapCountSql(identity: string): string {
	return `(select count(*) from history_archive_listing_gap listing_gap
		where listing_gap."archiveUrlIdentity" = ${identity}
			and listing_gap."resolvedAt" is null)`;
}

export const knownArchiveListingGapJoinSql = `
	left join lateral (
		select gap."firstCheckpointLedger"
		from history_archive_listing_gap gap
		where gap."archiveUrlIdentity" = root."archiveUrlIdentity"
			and gap."resolvedAt" is null
		order by gap."firstCheckpointLedger", gap."lastCheckpointLedger"
		limit 1
	) earliest_gap on true
	left join lateral (
		select jsonb_agg(to_jsonb(sample) order by sample."firstCheckpointLedger", sample."lastCheckpointLedger") as "listingGaps"
		from (
			select gap."firstCheckpointLedger", gap."lastCheckpointLedger",
				gap."resumeCheckpointLedger", gap."observedAt", gap."listingEvidence",
				proof.id::text as "sourceCheckpointProofId",
				proof."archiveUrlIdentity" as "sourceArchiveUrlIdentity"
			from (
				select gap.* from history_archive_listing_gap gap
				where gap."archiveUrlIdentity" = root."archiveUrlIdentity"
					and gap."resolvedAt" is null
				order by gap."firstCheckpointLedger", gap."lastCheckpointLedger"
				limit ${knownArchiveListingGapSampleLimit}
			) gap
			left join lateral (
				${historyArchiveListingGapAnchorSql('gap."archiveUrlIdentity"', 'gap."lastCheckpointLedger"')}
			) proof on true
		) sample
	) listing_gaps on true
`;

export function mapKnownArchiveListingGaps(
	value: unknown,
	identity: string
): readonly KnownArchiveListingGapV1[] {
	if (value === null || value === undefined) return [];
	if (!Array.isArray(value) || value.length > knownArchiveListingGapSampleLimit)
		throw new Error('Invalid archive listing gap sample');
	return value.map((row: unknown) => {
		if (typeof row !== 'object' || row === null || Array.isArray(row))
			throw new Error('Invalid archive listing gap row');
		const fields = row as Record<string, unknown>;
		const evidence = fields.listingEvidence;
		if (
			!isHistoryArchiveListingGapDTO(evidence) ||
			normalizeHistoryArchiveRootUrl(evidence.archiveRoot) !== identity ||
			evidence.missingFromCheckpoint !== fields.firstCheckpointLedger ||
			evidence.missingThroughCheckpoint !== fields.lastCheckpointLedger ||
			fields.resumeCheckpointLedger !==
				evidence.missingThroughCheckpoint + 64 ||
			typeof fields.observedAt !== 'string' ||
			!Number.isFinite(Date.parse(fields.observedAt)) ||
			!(
				fields.sourceCheckpointProofId === null ||
				(typeof fields.sourceCheckpointProofId === 'string' &&
					/^\d+$/.test(fields.sourceCheckpointProofId))
			) ||
			!(
				fields.sourceArchiveUrlIdentity === null ||
				typeof fields.sourceArchiveUrlIdentity === 'string'
			)
		)
			throw new Error('Invalid archive listing gap evidence');
		return {
			kind: evidence.kind,
			firstCheckpointLedger: evidence.missingFromCheckpoint,
			lastCheckpointLedger: evidence.missingThroughCheckpoint,
			resumeCheckpointLedger: evidence.missingThroughCheckpoint + 64,
			checkpointCount:
				(evidence.missingThroughCheckpoint - evidence.missingFromCheckpoint) /
					64 +
				1,
			observedAt: new Date(fields.observedAt).toISOString(),
			sourceCheckpointProofId: fields.sourceCheckpointProofId,
			sourceArchiveUrlIdentity: fields.sourceArchiveUrlIdentity,
			listings: evidence.listings
		};
	});
}

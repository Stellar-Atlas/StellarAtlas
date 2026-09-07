import type { EntityManager } from 'typeorm';
import {
	isHistoryArchiveListingGapDTO,
	type HistoryArchiveListingGapDTO
} from 'history-scanner-dto';

// Called only after the actual failed claim is accepted, in that transaction.
export async function persistHistoryArchiveListingGap(
	manager: EntityManager,
	remoteId: string,
	gap: HistoryArchiveListingGapDTO
): Promise<void> {
	if (!isHistoryArchiveListingGapDTO(gap) || !listingLocationsMatchRoot(gap))
		return;
	await manager.query(
		`
		with observed as (
			select object."archiveUrlIdentity", state."networkPassphrase"
			from history_archive_object_queue object
			join history_archive_state_snapshot state
				on state."archiveUrlIdentity" = object."archiveUrlIdentity"
			where object."remoteId" = $1::uuid and object.status = 'failed'
				and object."objectType" = 'checkpoint-state' and object."httpStatus" = 404
				and object."failureChannel" in ('archive_evidence', 'archive_availability')
				and object."archiveUrlIdentity" = $2::text
				and object."checkpointLedger" = $3::integer
				and $5::timestamptz between now() - interval '10 minutes' and now() + interval '1 minute'
		), candidate as (
			select observed.*, source.id as source_id
			from observed
			left join lateral (
				select proof.id from history_archive_checkpoint_proof proof
				join history_archive_state_snapshot source_state
					on source_state."archiveUrlIdentity" = proof."archiveUrlIdentity"
					and source_state.status = 'available'
					and source_state."networkPassphrase" = observed."networkPassphrase"
				where proof."checkpointLedger" = $4::integer
					and proof."archiveUrlIdentity" <> observed."archiveUrlIdentity"
					and proof.status = 'verified' and proof."requiredObjectsComplete" = true
					and proof."proofFactsComplete" = true and proof."failureKind" is null
				order by proof."evaluatedAt", proof.id limit 1
			) source on true
		)
		insert into history_archive_listing_gap (
			"archiveUrlIdentity", "firstCheckpointLedger", "lastCheckpointLedger",
			"resumeCheckpointLedger", "observedAt", "listingEvidence", "sourceCheckpointProofId"
		)
		select candidate."archiveUrlIdentity", $3, $4, $4 + 64, $5, $6::jsonb, source_id
		from candidate
		where not exists (
			select 1 from history_archive_listing_gap existing
			where existing."archiveUrlIdentity" = candidate."archiveUrlIdentity"
				and existing."firstCheckpointLedger" <= $3
				and existing."lastCheckpointLedger" >= $4 and existing."resolvedAt" is null
		)
		on conflict ("archiveUrlIdentity", "firstCheckpointLedger", "lastCheckpointLedger") do nothing
	`,
		[
			remoteId,
			gap.archiveRoot.replace(/\/+$/, ''),
			gap.missingFromCheckpoint,
			gap.missingThroughCheckpoint,
			gap.observedAt,
			JSON.stringify(gap)
		]
	);
}

function listingLocationsMatchRoot(gap: HistoryArchiveListingGapDTO): boolean {
	try {
		const root = new URL(gap.archiveRoot);
		let bucket = root.hostname;
		let path = decodeURIComponent(root.pathname)
			.replace(/^\//, '')
			.replace(/\/+$/, '');
		if (gap.kind === 'directory-listing-gap') return true; // Shared validator binds every directory and range to this root.
		if (gap.kind === 's3-listing-gap') {
			return gap.listings.every((item) => {
				const url = new URL(item.listingUrl);
				return (
					url.origin === root.origin &&
					url.pathname === '/' &&
					url.searchParams.get('prefix') ===
						(path ? path + '/' : '') + item.category + '/'
				);
			});
		}
		if (root.hostname === 'storage.googleapis.com') {
			const slash = path.indexOf('/');
			bucket = slash < 0 ? path : path.slice(0, slash);
			path = slash < 0 ? '' : path.slice(slash + 1);
		} else if (root.hostname.endsWith('.storage.googleapis.com')) {
			bucket = root.hostname.slice(0, -'.storage.googleapis.com'.length);
		}
		return gap.listings.every((item) => {
			const url = new URL(item.listingUrl);
			return (
				decodeURIComponent(url.pathname) === '/' + bucket &&
				url.searchParams.get('prefix') ===
					(path ? path + '/' : '') + item.category + '/'
			);
		});
	} catch {
		return false;
	}
}

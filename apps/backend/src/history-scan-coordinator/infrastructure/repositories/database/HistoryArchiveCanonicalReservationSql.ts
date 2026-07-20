export const canonicalFrontierReservationCtesSql = `
	canonical_reservation_state as materialized (
		select count(*)::integer as count
		from "history_archive_object_queue" reserved
		where reserved."executionDisposition" = 'executable'
			and reserved."executionReason" = 'canonical-frontier-reserve'
			and reserved.status in ('pending', 'scanning')
	), generic_replacements as materialized (
		select generic.id,
			row_number() over (
				order by generic."lastClaimedAt" desc nulls last,
					generic."updatedAt", generic.id
			) as replacement_rank
		from "history_archive_object_queue" generic
		where generic.status = 'pending'
			and generic."executionDisposition" = 'executable'
			and generic."dependencyReady" = true
			and generic."executionReason" is distinct from
				'canonical-frontier-reserve'
			and (
				generic."transitionEffectsRequiredAt" is null
				or generic."transitionEffectsCompletedAt" is not null
			)
		order by generic."lastClaimedAt" desc nulls last,
			generic."updatedAt", generic.id
		limit $1::integer
	), candidate_replacement_ranked as materialized (
		select target_ranked.*,
			row_number() over (
				order by target_rank, target_lane, proof_progress desc,
					"lastClaimedAt" asc nulls first,
					"archiveUrlIdentity", id
			) as candidate_replacement_rank
		from target_ranked
	), replacement_ranked as materialized (
		select candidate.*, replacement.id as selected_replaceable_id
		from candidate_replacement_ranked candidate
		left join generic_replacements replacement
			on replacement.replacement_rank =
				candidate.candidate_replacement_rank
	), additions_ranked as materialized (
		select replacement_ranked.*,
			count(*) filter (where selected_replaceable_id is null) over (
				order by target_rank, target_lane, proof_progress desc,
					"lastClaimedAt" asc nulls first,
					"archiveUrlIdentity", id
			) as addition_rank
		from replacement_ranked
	)
`;

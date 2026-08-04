export const canonicalFrontierReservationCtesSql = `
	canonical_reservation_state as materialized (
		select count(*)::integer as count
		from "history_archive_object_queue" reserved
		where reserved."executionDisposition" = 'executable'
			and reserved."executionReason" = 'canonical-frontier-reserve'
			and reserved.status in ('pending', 'scanning')
	), stale_canonical_replacements as materialized (
		select reserved.id,
			row_number() over (
				order by reserved."lastClaimedAt" desc nulls last,
					reserved."updatedAt", reserved.id
			) as replacement_rank
		from "history_archive_object_queue" reserved
		where reserved.status = 'pending'
			and reserved."executionDisposition" = 'executable'
			and reserved."executionReason" = 'canonical-frontier-reserve'
			and not exists (
				select 1
				from current_canonical_reservations current_reservation
				where current_reservation.id = reserved.id
			)
		order by reserved."lastClaimedAt" desc nulls last,
			reserved."updatedAt", reserved.id
		limit $1::integer
	), stale_canonical_replacement_state as materialized (
		select count(*)::integer as count
		from stale_canonical_replacements
	), generic_replacements as materialized (
		select generic.id,
			stale.count + row_number() over (
				order by generic."lastClaimedAt" desc nulls last,
					generic."updatedAt", generic.id
			) as replacement_rank
		from "history_archive_object_queue" generic
		cross join stale_canonical_replacement_state stale
		where generic.status = 'pending'
			and generic."executionDisposition" = 'executable'
			and generic."dependencyReady" = true
			and generic."executionReason" is distinct from
				'canonical-frontier-reserve'
			and not exists (
				select 1
				from target_ranked canonical_candidate
				where canonical_candidate.id = generic.id
			)
			and (
				generic."transitionEffectsRequiredAt" is null
				or generic."transitionEffectsCompletedAt" is not null
			)
		order by generic."lastClaimedAt" desc nulls last,
			generic."updatedAt", generic.id
		limit $1::integer
	), replacement_candidates as materialized (
		select id, replacement_rank from stale_canonical_replacements
		union all
		select id, replacement_rank from generic_replacements
	), canonical_candidate_capacity as materialized (
		select greatest($1::integer - reservation.count, 0) + stale.count
			as count
		from canonical_reservation_state reservation
		cross join stale_canonical_replacement_state stale
	), candidate_replacement_ranked as materialized (
		select target_ranked.*,
			row_number() over (
				order by coalesce(reservation.count, 0) + target_rank,
					target_ranked.target_lane, proof_progress desc,
					"lastClaimedAt" asc nulls first,
					"archiveUrlIdentity", id
			) as candidate_replacement_rank
		from target_ranked
		left join canonical_lane_reservation_state reservation
			on reservation.target_lane = target_ranked.target_lane
	), replacement_ranked as materialized (
		select candidate.*, replacement.id as selected_replaceable_id
		from candidate_replacement_ranked candidate
		left join replacement_candidates replacement
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

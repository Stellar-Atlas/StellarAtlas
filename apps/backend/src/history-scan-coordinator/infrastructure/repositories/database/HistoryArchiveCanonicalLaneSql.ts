export const canonicalLaneReservationCtesSql = `
	current_canonical_reservations as materialized (
		select distinct on (reserved.id)
			reserved.id, desired.target_lane
		from desired_objects desired
		join "history_archive_object_queue" reserved
			on reserved."archiveUrlIdentity" = desired."archiveUrlIdentity"
			and reserved."objectType" = desired.object_type
			and reserved."objectKey" = desired.object_key
			and reserved."checkpointLedger" is not distinct from
				desired.object_checkpoint_ledger
			and reserved.status in ('pending', 'scanning')
			and reserved."executionDisposition" = 'executable'
			and reserved."executionReason" = 'canonical-frontier-reserve'
		order by reserved.id,
			case desired.target_lane
				when 'historical' then 0
				when 'forward' then 1
				else 2
			end
	), canonical_lane_reservation_state as materialized (
		select lane.target_lane,
			count(reserved.id)::integer as count
		from (
			select distinct desired.target_lane
			from desired_objects desired
		) lane
		left join current_canonical_reservations reserved
			on reserved.target_lane = lane.target_lane
		group by lane.target_lane
	)
`;

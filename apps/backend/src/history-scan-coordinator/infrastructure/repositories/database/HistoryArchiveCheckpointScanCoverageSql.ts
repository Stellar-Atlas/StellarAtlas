/** One changed page per 4096 positions, exact union deltas even under concurrent OR. */
export const historyArchiveCheckpointScanCoverageSql = `
	with checked_positions as materialized (
		select "archiveUrlIdentity", ("checkpointLedger"::bigint - 63) / 64 as position
		from jsonb_to_recordset($1::jsonb) input("archiveUrlIdentity" text, "checkpointLedger" integer)
	), listing_ranges as materialized (
		select "archiveUrlIdentity", ("firstCheckpointLedger"::bigint - 63) / 64 as first_position,
			("lastCheckpointLedger"::bigint - 63) / 64 as last_position
		from jsonb_to_recordset($2::jsonb) input(
			"archiveUrlIdentity" text, "firstCheckpointLedger" integer, "lastCheckpointLedger" integer
		)
	), masks as (
		select "archiveUrlIdentity", (position / 4096)::integer as "pageIndex",
			set_bit(B'0'::bit(4096), (position % 4096)::integer, 1) as checked,
			B'0'::bit(4096) as listed
		from checked_positions
		union all
		select range."archiveUrlIdentity", page::integer, B'0'::bit(4096),
			(repeat('0', first_bit) || repeat('1', last_bit - first_bit + 1) ||
				repeat('0', 4095 - last_bit))::bit(4096)
		from listing_ranges range
		cross join lateral generate_series(range.first_position / 4096, range.last_position / 4096) page
		cross join lateral (
			select greatest(range.first_position - page * 4096, 0)::integer as first_bit,
				least(range.last_position - page * 4096, 4095)::integer as last_bit
		) bounds
	), grouped as materialized (
		select "archiveUrlIdentity", "pageIndex", bit_or(checked) as checked, bit_or(listed) as listed
		from masks group by "archiveUrlIdentity", "pageIndex"
	), changed_pages as (
		insert into history_archive_checkpoint_scan_bitmap as stored (
			"archiveUrlIdentity", "pageIndex", "checkedBitmap", "listingBitmap",
			"lastAddedCheckedCount", "lastAddedListingCount", "lastAddedScannedCount", "updatedAt"
		)
		select "archiveUrlIdentity", "pageIndex", checked, listed,
			bit_count(checked), bit_count(listed), bit_count(checked | listed), now()
		from grouped order by "archiveUrlIdentity", "pageIndex"
		on conflict ("archiveUrlIdentity", "pageIndex") do update set
			"lastAddedCheckedCount" = bit_count(stored."checkedBitmap" | excluded."checkedBitmap") - stored."checkedCheckpointCount",
			"lastAddedListingCount" = bit_count(stored."listingBitmap" | excluded."listingBitmap") - stored."listingCheckpointCount",
			"lastAddedScannedCount" = bit_count(stored."checkedBitmap" | excluded."checkedBitmap" | stored."listingBitmap" | excluded."listingBitmap") - stored."scannedCheckpointCount",
			"checkedBitmap" = stored."checkedBitmap" | excluded."checkedBitmap",
			"listingBitmap" = stored."listingBitmap" | excluded."listingBitmap",
			"updatedAt" = now()
		where (stored."checkedBitmap" | excluded."checkedBitmap") <> stored."checkedBitmap"
			or (stored."listingBitmap" | excluded."listingBitmap") <> stored."listingBitmap"
		returning "archiveUrlIdentity", "lastAddedCheckedCount", "lastAddedListingCount", "lastAddedScannedCount"
	), root_deltas as materialized (
		select "archiveUrlIdentity", sum("lastAddedCheckedCount") as checked,
			sum("lastAddedListingCount") as listed, sum("lastAddedScannedCount") as scanned
		from changed_pages group by "archiveUrlIdentity"
	), updated_roots as (
		insert into history_archive_checkpoint_scan_summary as stored (
			"archiveUrlIdentity", "checkedCheckpointPositions", "listingCoveredCheckpointPositions",
			"scannedCheckpointPositions", "updatedAt"
		)
		select "archiveUrlIdentity", checked, listed, scanned, now()
		from root_deltas order by "archiveUrlIdentity"
		on conflict ("archiveUrlIdentity") do update set
			"checkedCheckpointPositions" = stored."checkedCheckpointPositions" + excluded."checkedCheckpointPositions",
			"listingCoveredCheckpointPositions" = stored."listingCoveredCheckpointPositions" + excluded."listingCoveredCheckpointPositions",
			"scannedCheckpointPositions" = stored."scannedCheckpointPositions" + excluded."scannedCheckpointPositions",
			"updatedAt" = now()
		returning "archiveUrlIdentity"
	)
	select (select count(*)::integer from changed_pages) as "changedPages",
		(select count(*)::integer from updated_roots) as "changedRoots"
`;

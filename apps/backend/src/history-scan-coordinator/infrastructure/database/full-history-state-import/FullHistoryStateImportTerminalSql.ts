import type { DataSource } from 'typeorm';
import type { FullHistoryStateImportClaim } from '../../../domain/full-history-state-import/FullHistoryStateImport.js';

interface IdentityRow {
	readonly batchId: string;
}

function claimIdentity(claim: FullHistoryStateImportClaim): unknown[] {
	return [
		claim.batchId,
		claim.dataset,
		claim.leaseOwner,
		claim.attemptCount
	];
}

function assertTransitioned(rows: readonly IdentityRow[]): void {
	if (rows.length !== 1) throw new Error('State import lease was lost');
}

export async function failFullHistoryStateImportClaim(
	dataSource: DataSource,
	claim: FullHistoryStateImportClaim,
	error: Error
): Promise<void> {
	const message = error.message.trim().slice(0, 65_535) || 'State import failed';
	const rows = await dataSource.query<IdentityRow[]>(
		`
		with failed as (
			update "full_history_lcm_state_import"
			set "status" = 'failed', "lease_owner" = null,
				"lease_expires_at" = null, "completed_at" = null,
				"updated_at" = clock_timestamp(), "error_text" = $5,
				"next_attempt_at" = clock_timestamp() + (
					least(3600, power(2, least("attempt_count", 10)))
					* interval '1 second'
				)
			where "batch_id" = $1 and "dataset" = $2
				and "status" = 'importing' and "lease_owner" = $3
				and "attempt_count" = $4
				and "lease_expires_at" > clock_timestamp()
			returning "batch_id"
		)
		select "batch_id" as "batchId" from failed
	`,
		[...claimIdentity(claim), message]
	);
	assertTransitioned(rows);
}

export async function releaseFullHistoryStateImportClaim(
	dataSource: DataSource,
	claim: FullHistoryStateImportClaim
): Promise<void> {
	const rows = await dataSource.query<IdentityRow[]>(
		`
		with released as (
			update "full_history_lcm_state_import"
			set "status" = 'pending', "lease_owner" = null,
				"lease_expires_at" = null, "completed_at" = null,
				"updated_at" = clock_timestamp(), "error_text" = null,
				"next_attempt_at" = clock_timestamp()
			where "batch_id" = $1 and "dataset" = $2
				and "status" = 'importing' and "lease_owner" = $3
				and "attempt_count" = $4
			returning "batch_id"
		)
		select "batch_id" as "batchId" from released
	`,
		claimIdentity(claim)
	);
	assertTransitioned(rows);
}

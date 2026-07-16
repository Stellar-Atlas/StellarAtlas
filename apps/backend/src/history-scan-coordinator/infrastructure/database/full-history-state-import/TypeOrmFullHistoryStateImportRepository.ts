import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import {
	fullHistoryLedgerCloseMetaSequence,
	fullHistoryLedgerCloseMetaSha256Digest
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type {
	FullHistoryAccountStateChange,
	FullHistoryTrustlineStateChange
} from '../../../domain/full-history-state-import/FullHistoryStateExport.js';
import type {
	FullHistoryStateImportClaim,
	FullHistoryStateImportClaimOrder,
	FullHistoryStateImportRepository
} from '../../../domain/full-history-state-import/FullHistoryStateImport.js';
import type { FullHistoryStateRowEvidence } from '../../../domain/full-history-state-import/FullHistoryStateRowEvidence.js';
import { assertUuid } from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	accountStateInsertQuery,
	stateRowDigestVerificationQuery,
	trustlineStateInsertQuery
} from './FullHistoryStateImportRowSql.js';

interface ClaimRow {
	readonly attemptCount: number;
	readonly batchId: string;
	readonly dataset: string;
	readonly endLedger: string;
	readonly expectedRecordCount: string;
	readonly leaseOwner: string;
	readonly sourceSha256: Uint8Array;
	readonly startLedger: string;
	readonly storageKey: string;
}

interface CountRow {
	readonly count: string;
}

interface ImportControlRow {
	readonly active: boolean;
	readonly attemptCount: number;
	readonly expectedRecordCount: string;
	readonly leaseOwner: string | null;
	readonly status: string;
}

interface ActiveClaimRow {
	readonly active: boolean;
}

interface DigestRow {
	readonly changeIndex: string;
	readonly ledgerSequence: string;
	readonly rowSha256: Uint8Array;
	readonly transactionIndex: string;
}

interface IdentityRow {
	readonly batchId: string;
}

const maximumLeaseMilliseconds = 30 * 60_000;
const stateDatasets = [
	'account-state-changes',
	'trustline-state-changes'
] as const;

export class TypeOrmFullHistoryStateImportRepository implements FullHistoryStateImportRepository {
	constructor(private readonly dataSource: DataSource) {}

	async registerPendingImports(): Promise<number> {
		return this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager);
			const inserted = await manager.query<IdentityRow[]>(
				`
				insert into "full_history_lcm_state_import" (
					"batch_id", "dataset", "source_path", "source_sha256",
					"expected_record_count"
				)
				select dataset."batch_id", dataset."dataset",
					dataset."storage_key", dataset."output_sha256",
					dataset."record_count"
				from "full_history_ledger_close_meta_dataset" dataset
				where dataset."dataset" = any($1::text[])
				on conflict ("batch_id", "dataset") do nothing
				returning "batch_id" as "batchId"
			`,
				[stateDatasets]
			);
			const mismatch = await manager.query<CountRow[]>(
				`
				select count(*)::text as "count"
				from "full_history_lcm_state_import" control
				join "full_history_ledger_close_meta_dataset" dataset
					on dataset."batch_id" = control."batch_id"
					and dataset."dataset" = control."dataset"
				where control."dataset" = any($1::text[])
					and (control."source_path" <> dataset."storage_key"
						or control."source_sha256" <> dataset."output_sha256"
						or control."expected_record_count" <> dataset."record_count")
			`,
				[stateDatasets]
			);
			if (BigInt(exactlyOne(mismatch, 'state import mismatch').count) !== 0n) {
				throw new Error('LedgerCloseMeta state import source metadata drifted');
			}
			return inserted.length;
		});
	}

	async claimNext(
		leaseOwner: string,
		leaseDurationMilliseconds: number,
		claimOrder: FullHistoryStateImportClaimOrder = 'oldest-first'
	): Promise<FullHistoryStateImportClaim | null> {
		assertUuid(leaseOwner, 'leaseOwner');
		assertLeaseDuration(leaseDurationMilliseconds);
		assertClaimOrder(claimOrder);
		const rows = await this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager);
			return manager.query<ClaimRow[]>(
				`
				with candidate as (
					select control."batch_id", control."dataset"
					from "full_history_lcm_state_import" control
					join "full_history_ledger_close_meta_batch" batch
						on batch."id" = control."batch_id"
					where (control."status" in ('pending', 'failed')
							and control."next_attempt_at" <= clock_timestamp())
						or (control."status" = 'importing'
							and control."lease_expires_at" <= clock_timestamp())
					order by case when $3::boolean
							and control."status" <> 'pending' then 0 else 1 end,
						control."next_attempt_at", batch."start_ledger",
						control."dataset", control."batch_id"
					for update of control skip locked
					limit 1
				), claimed as (
					update "full_history_lcm_state_import" control
					set "status" = 'importing', "lease_owner" = $1,
						"lease_expires_at" = clock_timestamp()
							+ ($2 * interval '1 millisecond'),
						"attempt_count" = "attempt_count" + 1,
						"updated_at" = clock_timestamp(), "completed_at" = null,
						"error_text" = null
					from candidate
					where control."batch_id" = candidate."batch_id"
						and control."dataset" = candidate."dataset"
					returning control.*
				)
				select claimed."batch_id" as "batchId",
					claimed."attempt_count" as "attemptCount", claimed."dataset",
					batch."start_ledger"::text as "startLedger",
					batch."end_ledger"::text as "endLedger",
					claimed."expected_record_count"::text as "expectedRecordCount",
					claimed."lease_owner"::text as "leaseOwner",
					claimed."source_path" as "storageKey",
					claimed."source_sha256" as "sourceSha256"
				from claimed join "full_history_ledger_close_meta_batch" batch
					on batch."id" = claimed."batch_id"
			`,
				[leaseOwner, leaseDurationMilliseconds, claimOrder === 'recovery-first']
			);
		});
		return rows.length === 0 ? null : mapClaim(exactlyOne(rows, 'state claim'));
	}

	async storeAccountRows(
		claim: FullHistoryStateImportClaim,
		rows: readonly FullHistoryStateRowEvidence<FullHistoryAccountStateChange>[]
	): Promise<void> {
		assertClaimDataset(claim, 'account-state-changes');
		await this.storeRows(
			claim,
			'full_history_lcm_account_state_change',
			accountStateInsertQuery(claim.batchId, rows),
			rows
		);
	}

	async storeTrustlineRows(
		claim: FullHistoryStateImportClaim,
		rows: readonly FullHistoryStateRowEvidence<FullHistoryTrustlineStateChange>[]
	): Promise<void> {
		assertClaimDataset(claim, 'trustline-state-changes');
		await this.storeRows(
			claim,
			'full_history_lcm_trustline_state_change',
			trustlineStateInsertQuery(claim.batchId, rows),
			rows
		);
	}

	private async storeRows(
		claim: FullHistoryStateImportClaim,
		table:
			| 'full_history_lcm_account_state_change'
			| 'full_history_lcm_trustline_state_change',
		insert: { readonly parameters: readonly unknown[]; readonly sql: string },
		rows: readonly FullHistoryStateRowEvidence[]
	): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager);
			await assertActiveClaim(manager, claim);
			await manager.query(insert.sql, [...insert.parameters]);
			const verification = stateRowDigestVerificationQuery(
				table,
				claim.batchId,
				rows
			);
			const matches = exactlyOne(
				await manager.query<CountRow[]>(verification.sql, [
					...verification.parameters
				]),
				'state row digest verification'
			);
			if (BigInt(matches.count) !== BigInt(rows.length)) {
				throw new Error('Stored state rows differ from exported row evidence');
			}
		});
	}

	async renewLease(
		claim: FullHistoryStateImportClaim,
		leaseDurationMilliseconds: number
	): Promise<void> {
		assertLeaseDuration(leaseDurationMilliseconds);
		const rows = await this.dataSource.query<IdentityRow[]>(
			`
			with renewed as (
				update "full_history_lcm_state_import"
				set "lease_expires_at" = clock_timestamp()
					+ ($5 * interval '1 millisecond'),
					"updated_at" = clock_timestamp()
				where "batch_id" = $1 and "dataset" = $2
					and "status" = 'importing' and "lease_owner" = $3
					and "attempt_count" = $4
					and "lease_expires_at" > clock_timestamp()
				returning "batch_id"
			)
			select "batch_id" as "batchId" from renewed
		`,
			[
				claim.batchId,
				claim.dataset,
				claim.leaseOwner,
				claim.attemptCount,
				leaseDurationMilliseconds
			]
		);
		if (rows.length !== 1) throw new Error('State import lease was lost');
	}

	async complete(
		claim: FullHistoryStateImportClaim,
		exportedRecordCount: bigint,
		rowSetSha256: ReturnType<typeof fullHistoryLedgerCloseMetaSha256Digest>
	): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager, 120_000);
			const control = exactlyOne(
				await manager.query<ImportControlRow[]>(
					`
					select "attempt_count" as "attemptCount",
						"expected_record_count"::text as "expectedRecordCount",
						"lease_owner"::text as "leaseOwner", "status",
						("lease_expires_at" > clock_timestamp()) as "active"
					from "full_history_lcm_state_import"
					where "batch_id" = $1 and "dataset" = $2 for update
				`,
					[claim.batchId, claim.dataset]
				),
				'state import control'
			);
			const expected = BigInt(control.expectedRecordCount);
			if (
				control.status !== 'importing' ||
				!control.active ||
				control.leaseOwner !== claim.leaseOwner ||
				control.attemptCount !== claim.attemptCount ||
				expected !== claim.expectedRecordCount ||
				exportedRecordCount !== expected
			) {
				throw new Error('State import completion does not match its lease');
			}
			const stored = await calculateStoredRowSetEvidence(manager, claim);
			if (stored.count !== expected || stored.rowSetSha256 !== rowSetSha256) {
				throw new Error(
					'State import stored row set does not match its exported evidence'
				);
			}
			const completed = await manager.query<IdentityRow[]>(
				`
				with completed as (
				update "full_history_lcm_state_import"
				set "status" = 'complete', "imported_record_count" = $5,
					"imported_row_set_sha256" = $6,
					"lease_owner" = null, "lease_expires_at" = null,
					"completed_at" = clock_timestamp(),
					"updated_at" = clock_timestamp(), "error_text" = null
				where "batch_id" = $1 and "dataset" = $2
					and "status" = 'importing' and "lease_owner" = $3
					and "attempt_count" = $4
					and "lease_expires_at" > clock_timestamp()
				returning "batch_id"
				)
				select "batch_id" as "batchId" from completed
			`,
				[
					claim.batchId,
					claim.dataset,
					claim.leaseOwner,
					claim.attemptCount,
					stored.count.toString(),
					Buffer.from(rowSetSha256, 'hex')
				]
			);
			if (completed.length !== 1) {
				throw new Error('State import completion lost its lease');
			}
		});
	}

	async fail(claim: FullHistoryStateImportClaim, error: Error): Promise<void> {
		const message =
			error.message.trim().slice(0, 65_535) || 'State import failed';
		const rows = await this.dataSource.query<IdentityRow[]>(
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
			[
				claim.batchId,
				claim.dataset,
				claim.leaseOwner,
				claim.attemptCount,
				message
			]
		);
		if (rows.length !== 1) throw new Error('State import lease was lost');
	}
}

async function calculateStoredRowSetEvidence(
	manager: EntityManager,
	claim: FullHistoryStateImportClaim
): Promise<{
	readonly count: bigint;
	readonly rowSetSha256: ReturnType<
		typeof fullHistoryLedgerCloseMetaSha256Digest
	>;
}> {
	const table =
		claim.dataset === 'account-state-changes'
			? 'full_history_lcm_account_state_change'
			: 'full_history_lcm_trustline_state_change';
	const hash = createHash('sha256');
	let count = 0n;
	let cursor: [string, string, string] = ['0', '0', '0'];
	for (;;) {
		const rows = await manager.query<DigestRow[]>(
			`select "ledger_sequence"::text as "ledgerSequence",
				"transaction_index"::text as "transactionIndex",
				"change_index"::text as "changeIndex",
				"row_sha256" as "rowSha256"
			 from "${table}"
			 where "batch_id" = $1
				and ("ledger_sequence", "transaction_index", "change_index")
					> ($2::bigint, $3::bigint, $4::bigint)
			 order by "ledger_sequence", "transaction_index", "change_index"
			 limit 10000`,
			[claim.batchId, ...cursor]
		);
		for (const row of rows) hash.update(Buffer.from(row.rowSha256));
		count += BigInt(rows.length);
		if (rows.length < 10_000) break;
		const last = rows.at(-1);
		if (last === undefined) throw new Error('State digest page was empty');
		cursor = [last.ledgerSequence, last.transactionIndex, last.changeIndex];
	}
	return {
		count,
		rowSetSha256: fullHistoryLedgerCloseMetaSha256Digest(hash.digest('hex'))
	};
}

async function assertActiveClaim(
	manager: EntityManager,
	claim: FullHistoryStateImportClaim
): Promise<void> {
	const row = exactlyOne(
		await manager.query<ActiveClaimRow[]>(
			`select ("status" = 'importing' and "lease_owner" = $3
				and "attempt_count" = $4
				and "lease_expires_at" > clock_timestamp()) as "active"
			 from "full_history_lcm_state_import"
			 where "batch_id" = $1 and "dataset" = $2
			 for share`,
			[claim.batchId, claim.dataset, claim.leaseOwner, claim.attemptCount]
		),
		'state import lease'
	);
	if (!row.active)
		throw new Error('State import lease was lost before row write');
}

function mapClaim(row: ClaimRow): FullHistoryStateImportClaim {
	if (!stateDatasets.includes(row.dataset as (typeof stateDatasets)[number])) {
		throw new TypeError('Unknown state import dataset');
	}
	return Object.freeze({
		attemptCount: validAttemptCount(row.attemptCount),
		batchId: assertUuid(row.batchId, 'batchId'),
		dataset: row.dataset as (typeof stateDatasets)[number],
		endLedger: fullHistoryLedgerCloseMetaSequence(Number(row.endLedger)),
		expectedRecordCount: BigInt(row.expectedRecordCount),
		leaseOwner: assertUuid(row.leaseOwner, 'leaseOwner'),
		sourceSha256: fullHistoryLedgerCloseMetaSha256Digest(
			Buffer.from(row.sourceSha256).toString('hex')
		),
		startLedger: fullHistoryLedgerCloseMetaSequence(Number(row.startLedger)),
		storageKey: validStorageKey(row.storageKey)
	});
}

function validAttemptCount(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError('State import attempt count is invalid');
	}
	return value;
}

function validStorageKey(value: string): string {
	if (
		value.length === 0 ||
		value.length > 2_048 ||
		value.startsWith('/') ||
		value.includes('\\') ||
		value.split('/').some((part) => part.length === 0 || part === '..')
	) {
		throw new TypeError('State import storage key is invalid');
	}
	return value;
}

function assertLeaseDuration(value: number): void {
	if (
		!Number.isInteger(value) ||
		value < 10_000 ||
		value > maximumLeaseMilliseconds
	) {
		throw new TypeError('State import lease duration is outside its bounds');
	}
}

function assertClaimOrder(value: FullHistoryStateImportClaimOrder): void {
	if (value !== 'oldest-first' && value !== 'recovery-first') {
		throw new TypeError('State import claim order is invalid');
	}
}

function assertClaimDataset(
	claim: FullHistoryStateImportClaim,
	expected: FullHistoryStateImportClaim['dataset']
): void {
	if (claim.dataset !== expected)
		throw new TypeError('State import dataset mismatch');
}

async function setTransactionBounds(
	manager: EntityManager,
	statementTimeoutMilliseconds = 30_000
): Promise<void> {
	await manager.query(
		`select set_config('lock_timeout', '2000ms', true),
			set_config('statement_timeout', $1, true)`,
		[`${statementTimeoutMilliseconds}ms`]
	);
}

function exactlyOne<T>(rows: readonly T[], name: string): T {
	if (rows.length !== 1) throw new Error(`Expected one ${name} row`);
	return rows[0]!;
}

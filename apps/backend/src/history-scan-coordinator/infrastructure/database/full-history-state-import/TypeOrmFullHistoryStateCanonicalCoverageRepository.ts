import type { DataSource, EntityManager } from 'typeorm';
import {
	fullHistoryLedgerCloseMetaSequence,
	fullHistoryLedgerCloseMetaSha256Digest
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type {
	FullHistoryLedgerProjection,
	FullHistoryStateCanonicalCoverageClaim,
	FullHistoryStateCanonicalCoverageReceipt,
	FullHistoryStateCanonicalCoverageRepository
} from '../../../domain/full-history-state-import/FullHistoryLedgerProjection.js';
import {
	buildFullHistorySqlValues,
	chunkFullHistoryValues
} from '../full-history/FullHistorySqlValues.js';
import {
	readFullHistoryCanonicalCoverageStats,
	type FullHistoryCanonicalCoverageStats
} from './FullHistoryCanonicalCoverageStats.js';
import { assertStoredFullHistoryLedgerProjections } from './FullHistoryLedgerProjectionReplayVerifier.js';

const ledgerInsertChunkSize = 256;
const maximumLeaseMilliseconds = 3_600_000;

interface ClaimRow {
	readonly attemptCount: number;
	readonly batchId: string;
	readonly endLedger: string;
	readonly expectedLedgerCount: number;
	readonly leaseOwner: string;
	readonly ledgerSourceSha256: Buffer;
	readonly networkPassphraseHash: Buffer;
	readonly startLedger: string;
	readonly storageKey: string;
}

interface CountRow {
	readonly count: string;
}

interface CoverageControlRow {
	readonly active: boolean;
	readonly attemptCount: number;
	readonly expectedLedgerCount: number;
	readonly leaseOwner: string | null;
	readonly status: string;
}

interface IdentityRow {
	readonly batchId: string;
}

export class TypeOrmFullHistoryStateCanonicalCoverageRepository implements FullHistoryStateCanonicalCoverageRepository {
	constructor(private readonly dataSource: DataSource) {}

	async registerPendingCoverage(): Promise<number> {
		return this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager);
			const inserted = await manager.query<IdentityRow[]>(`
				insert into "full_history_lcm_state_canonical_coverage" (
					"batch_id", "network_passphrase_hash", "ledger_source_path",
					"ledger_source_sha256", "expected_ledger_count"
				)
				select batch."id", batch."network_passphrase_hash",
					ledger."storage_key", ledger."output_sha256", batch."ledger_count"
				from "full_history_ledger_close_meta_batch" batch
				join "full_history_ledger_close_meta_dataset" ledger
					on ledger."batch_id" = batch."id" and ledger."dataset" = 'ledgers'
				where (select count(*) from "full_history_ledger_close_meta_dataset" state
					where state."batch_id" = batch."id" and state."dataset" in (
						'account-state-changes', 'trustline-state-changes'
					)) = 2
				on conflict do nothing
				returning "batch_id" as "batchId"
			`);
			const drift = await manager.query<CountRow[]>(`
				select count(*)::text as "count"
				from "full_history_lcm_state_canonical_coverage" coverage
				join "full_history_ledger_close_meta_batch" batch
					on batch."id" = coverage."batch_id"
				join "full_history_ledger_close_meta_dataset" ledger
					on ledger."batch_id" = batch."id" and ledger."dataset" = 'ledgers'
				where coverage."network_passphrase_hash" <> batch."network_passphrase_hash"
					or coverage."ledger_source_path" <> ledger."storage_key"
					or coverage."ledger_source_sha256" <> ledger."output_sha256"
					or coverage."expected_ledger_count" <> batch."ledger_count"
			`);
			if (BigInt(exactlyOne(drift, 'coverage drift').count) !== 0n) {
				throw new Error('Canonical coverage source metadata drifted');
			}
			return inserted.length;
		});
	}

	async claimNext(
		leaseOwner: string,
		leaseDurationMilliseconds: number
	): Promise<FullHistoryStateCanonicalCoverageClaim | null> {
		assertUuid(leaseOwner, 'leaseOwner');
		assertLeaseDuration(leaseDurationMilliseconds);
		const rows = await this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager);
			return manager.query<ClaimRow[]>(
				`
				with candidate as (
					select coverage."batch_id"
					from "full_history_lcm_state_canonical_coverage" coverage
					join "full_history_ledger_close_meta_batch" lcm
						on lcm."id" = coverage."batch_id"
					where ((coverage."status" = 'pending'
							and coverage."next_attempt_at" <= clock_timestamp())
						or (coverage."status" = 'checking'
							and coverage."lease_expires_at" <= clock_timestamp()))
						and (select count(*) from "full_history_lcm_state_import" state
								join "full_history_ledger_close_meta_dataset" dataset
									on dataset."batch_id" = state."batch_id"
									and dataset."dataset" = state."dataset"
									and dataset."storage_key" = state."source_path"
									and dataset."output_sha256" = state."source_sha256"
									and dataset."record_count" = state."expected_record_count"
								where state."batch_id" = coverage."batch_id"
									and state."status" = 'complete'
									and state."imported_record_count" = state."expected_record_count"
									and octet_length(state."imported_row_set_sha256") = 32) = 2
						and (select count(*) from "full_history_ledger" canonical
							join "full_history_ingestion_batch" proof
								on proof."id" = canonical."batch_id"
								and proof."network_passphrase_hash" = canonical."network_passphrase_hash"
							where canonical."network_passphrase_hash" = coverage."network_passphrase_hash"
								and canonical."ledger_sequence" between lcm."start_ledger" and lcm."end_ledger"
								and proof."proof_version" >= 6) = coverage."expected_ledger_count"
					order by coverage."next_attempt_at", lcm."start_ledger", coverage."batch_id"
					for update of coverage skip locked limit 1
				), claimed as (
					update "full_history_lcm_state_canonical_coverage" coverage
					set "status" = 'checking', "lease_owner" = $1,
						"lease_expires_at" = clock_timestamp()
							+ ($2 * interval '1 millisecond'),
						"attempt_count" = "attempt_count" + 1,
						"updated_at" = clock_timestamp(), "error_text" = null
					from candidate where coverage."batch_id" = candidate."batch_id"
					returning coverage.*
				)
				select claimed."batch_id" as "batchId",
					claimed."attempt_count" as "attemptCount",
					claimed."network_passphrase_hash" as "networkPassphraseHash",
					claimed."ledger_source_path" as "storageKey",
					claimed."ledger_source_sha256" as "ledgerSourceSha256",
					claimed."expected_ledger_count" as "expectedLedgerCount",
					claimed."lease_owner"::text as "leaseOwner",
					lcm."start_ledger"::text as "startLedger",
					lcm."end_ledger"::text as "endLedger"
				from claimed join "full_history_ledger_close_meta_batch" lcm
					on lcm."id" = claimed."batch_id"
			`,
				[leaseOwner, leaseDurationMilliseconds]
			);
		});
		return rows.length === 0
			? null
			: mapClaim(exactlyOne(rows, 'coverage claim'));
	}

	async storeLedgerRows(
		claim: FullHistoryStateCanonicalCoverageClaim,
		rows: readonly FullHistoryLedgerProjection[]
	): Promise<void> {
		for (const chunk of chunkFullHistoryValues(rows, ledgerInsertChunkSize)) {
			const values = buildFullHistorySqlValues(
				chunk.map((row) => [
					claim.batchId,
					row.ledgerSequence,
					Buffer.from(row.ledgerHash, 'hex'),
					Buffer.from(row.previousLedgerHash, 'hex'),
					Buffer.from(row.transactionSetHash, 'hex'),
					Buffer.from(row.transactionResultSetHash, 'hex'),
					Buffer.from(row.bucketListHash, 'hex'),
					row.protocolVersion,
					new Date(Number(BigInt(row.closedAtUnixMillis))),
					row.transactionCount
				])
			);
			await this.dataSource.transaction(async (manager) => {
				await setTransactionBounds(manager);
				await assertActiveCoverageLease(manager, claim, 'share');
				await manager.query(
					`insert into "full_history_lcm_ledger_projection" (
					"batch_id", "ledger_sequence", "ledger_hash",
					"previous_ledger_hash", "transaction_set_hash",
					"transaction_result_hash", "bucket_list_hash",
					"protocol_version", "closed_at", "transaction_count"
					) values ${values.placeholders} on conflict do nothing`,
					values.parameters
				);
				await assertStoredFullHistoryLedgerProjections(manager, claim, chunk);
			});
		}
	}

	async renewLease(
		claim: FullHistoryStateCanonicalCoverageClaim,
		leaseDurationMilliseconds: number
	): Promise<void> {
		assertLeaseDuration(leaseDurationMilliseconds);
		const rows = await this.dataSource.query<IdentityRow[]>(
			`with renewed as (
				update "full_history_lcm_state_canonical_coverage"
				set "lease_expires_at" = clock_timestamp()
					+ ($4 * interval '1 millisecond'), "updated_at" = clock_timestamp()
				where "batch_id" = $1 and "status" = 'checking' and "lease_owner" = $2
					and "attempt_count" = $3
					and "lease_expires_at" > clock_timestamp()
				returning "batch_id"
			) select "batch_id" as "batchId" from renewed`,
			[
				claim.batchId,
				claim.leaseOwner,
				claim.attemptCount,
				leaseDurationMilliseconds
			]
		);
		if (rows.length !== 1) throw new Error('Canonical coverage lease was lost');
	}

	async complete(
		claim: FullHistoryStateCanonicalCoverageClaim,
		exportedLedgerCount: bigint
	): Promise<FullHistoryStateCanonicalCoverageReceipt> {
		return this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager, 120_000);
			await assertActiveCompletion(manager, claim, exportedLedgerCount);
			const stats = await readFullHistoryCanonicalCoverageStats(manager, claim);
			if (stats.projectionCount !== claim.expectedLedgerCount) {
				throw new Error(
					'Stored ledger projection count does not match its manifest'
				);
			}
			if (
				stats.matchingCount !== claim.expectedLedgerCount ||
				stats.minimumProofVersion === null ||
				stats.latestProofEvaluatedAt === null
			) {
				await rejectMismatch(manager, claim, stats.matchingCount);
				return receipt(claim, stats, 'mismatch');
			}
			await storeCanonicalBatchLinks(manager, claim);
			const completed = await manager.query<IdentityRow[]>(
				`with completed as (
					update "full_history_lcm_state_canonical_coverage"
					set "status" = 'complete', "matched_ledger_count" = $4,
						"minimum_proof_version" = $5,
						"latest_proof_evaluated_at" = $6,
						"lease_owner" = null, "lease_expires_at" = null,
						"completed_at" = clock_timestamp(), "updated_at" = clock_timestamp(),
						"error_text" = null, "failure_kind" = null
					where "batch_id" = $1 and "status" = 'checking' and "lease_owner" = $2
						and "attempt_count" = $3
						and "lease_expires_at" > clock_timestamp()
					returning "batch_id"
				) select "batch_id" as "batchId" from completed`,
				[
					claim.batchId,
					claim.leaseOwner,
					claim.attemptCount,
					stats.matchingCount,
					stats.minimumProofVersion,
					stats.latestProofEvaluatedAt
				]
			);
			if (completed.length !== 1) {
				throw new Error('Canonical coverage completion lost its lease');
			}
			return receipt(claim, stats, 'complete');
		});
	}

	async fail(
		claim: FullHistoryStateCanonicalCoverageClaim,
		error: Error
	): Promise<void> {
		const message =
			error.message.trim().slice(0, 65_535) || 'Coverage check failed';
		const rows = await this.dataSource.query<IdentityRow[]>(
			`with failed as (
				update "full_history_lcm_state_canonical_coverage"
				set "status" = 'pending', "lease_owner" = null,
					"lease_expires_at" = null, "updated_at" = clock_timestamp(),
					"error_text" = $4, "next_attempt_at" = clock_timestamp() + (
						least(3600, power(2, least("attempt_count", 10))) * interval '1 second'
					)
				where "batch_id" = $1 and "status" = 'checking' and "lease_owner" = $2
					and "attempt_count" = $3
					and "lease_expires_at" > clock_timestamp()
				returning "batch_id"
			) select "batch_id" as "batchId" from failed`,
			[claim.batchId, claim.leaseOwner, claim.attemptCount, message]
		);
		if (rows.length !== 1) throw new Error('Canonical coverage lease was lost');
	}
}

async function assertActiveCompletion(
	manager: EntityManager,
	claim: FullHistoryStateCanonicalCoverageClaim,
	exportedLedgerCount: bigint
): Promise<void> {
	const row = exactlyOne(
		await manager.query<CoverageControlRow[]>(
			`select "attempt_count" as "attemptCount",
					"expected_ledger_count" as "expectedLedgerCount",
					"lease_owner"::text as "leaseOwner", "status",
					("lease_expires_at" > clock_timestamp()) as "active"
			 from "full_history_lcm_state_canonical_coverage"
			 where "batch_id" = $1 for update`,
			[claim.batchId]
		),
		'coverage control'
	);
	if (
		row.status !== 'checking' ||
		!row.active ||
		row.leaseOwner !== claim.leaseOwner ||
		row.attemptCount !== claim.attemptCount ||
		row.expectedLedgerCount !== claim.expectedLedgerCount ||
		exportedLedgerCount !== BigInt(claim.expectedLedgerCount)
	) {
		throw new Error('Canonical coverage completion does not match its lease');
	}
}

async function assertActiveCoverageLease(
	manager: EntityManager,
	claim: FullHistoryStateCanonicalCoverageClaim,
	lock: 'share' | 'update'
): Promise<void> {
	const row = exactlyOne(
		await manager.query<CoverageControlRow[]>(
			`select "attempt_count" as "attemptCount",
				"expected_ledger_count" as "expectedLedgerCount",
				"lease_owner"::text as "leaseOwner", "status",
				("lease_expires_at" > clock_timestamp()) as "active"
			 from "full_history_lcm_state_canonical_coverage"
			 where "batch_id" = $1 for ${lock}`,
			[claim.batchId]
		),
		'coverage lease'
	);
	if (
		!row.active ||
		row.status !== 'checking' ||
		row.leaseOwner !== claim.leaseOwner ||
		row.attemptCount !== claim.attemptCount ||
		row.expectedLedgerCount !== claim.expectedLedgerCount
	) {
		throw new Error('Canonical coverage lease was lost before evidence write');
	}
}

async function storeCanonicalBatchLinks(
	manager: EntityManager,
	claim: FullHistoryStateCanonicalCoverageClaim
): Promise<void> {
	await manager.query(
		`insert into "full_history_lcm_state_canonical_batch_link" (
			"lcm_batch_id", "canonical_batch_id", "network_passphrase_hash"
		) select distinct $1::uuid, canonical."batch_id", $2::bytea
		from "full_history_lcm_ledger_projection" projection
		join "full_history_ledger" canonical
			on canonical."network_passphrase_hash" = $2::bytea
			and canonical."ledger_sequence" = projection."ledger_sequence"
		where projection."batch_id" = $1::uuid on conflict do nothing`,
		[claim.batchId, Buffer.from(claim.networkPassphraseHash, 'hex')]
	);
}

async function rejectMismatch(
	manager: EntityManager,
	claim: FullHistoryStateCanonicalCoverageClaim,
	matchingCount: number
): Promise<void> {
	const rows = await manager.query<IdentityRow[]>(
		`with rejected as (
			update "full_history_lcm_state_canonical_coverage"
			set "status" = 'failed', "matched_ledger_count" = $4,
				"lease_owner" = null, "lease_expires_at" = null,
				"updated_at" = clock_timestamp(), "failure_kind" = 'ledger-mismatch',
				"error_text" = 'LedgerCloseMeta projection differs from canonical archive proof evidence'
			where "batch_id" = $1 and "status" = 'checking' and "lease_owner" = $2
				and "attempt_count" = $3
				and "lease_expires_at" > clock_timestamp()
			returning "batch_id"
		) select "batch_id" as "batchId" from rejected`,
		[claim.batchId, claim.leaseOwner, claim.attemptCount, matchingCount]
	);
	if (rows.length !== 1) {
		throw new Error('Canonical coverage mismatch result lost its lease');
	}
}

function receipt(
	claim: FullHistoryStateCanonicalCoverageClaim,
	stats: FullHistoryCanonicalCoverageStats,
	status: FullHistoryStateCanonicalCoverageReceipt['status']
): FullHistoryStateCanonicalCoverageReceipt {
	return Object.freeze({
		batchId: claim.batchId,
		canonicalBatchCount: stats.canonicalBatchCount,
		ledgerCount: stats.matchingCount,
		minimumProofVersion: stats.minimumProofVersion ?? 0,
		status
	});
}

function mapClaim(row: ClaimRow): FullHistoryStateCanonicalCoverageClaim {
	return Object.freeze({
		attemptCount: validAttemptCount(row.attemptCount),
		batchId: assertUuid(row.batchId, 'batchId'),
		endLedger: fullHistoryLedgerCloseMetaSequence(Number(row.endLedger)),
		expectedLedgerCount: row.expectedLedgerCount,
		leaseOwner: assertUuid(row.leaseOwner, 'leaseOwner'),
		ledgerSourceSha256: fullHistoryLedgerCloseMetaSha256Digest(
			row.ledgerSourceSha256.toString('hex')
		),
		networkPassphraseHash: fullHistoryLedgerCloseMetaSha256Digest(
			row.networkPassphraseHash.toString('hex')
		),
		startLedger: fullHistoryLedgerCloseMetaSequence(Number(row.startLedger)),
		storageKey: validStorageKey(row.storageKey)
	});
}

function validAttemptCount(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError('Canonical coverage attempt count is invalid');
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
		throw new TypeError('Canonical coverage storage key is invalid');
	}
	return value;
}

function assertLeaseDuration(value: number): void {
	if (
		!Number.isInteger(value) ||
		value < 10_000 ||
		value > maximumLeaseMilliseconds
	) {
		throw new TypeError(
			'Canonical coverage lease duration is outside its bounds'
		);
	}
}

function assertUuid(value: string, name: string): string {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value
		)
	) {
		throw new TypeError(`${name} must be a UUID`);
	}
	return value;
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

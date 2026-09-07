import type { DataSource, EntityManager } from 'typeorm';
import { historyArchivePublicSourcePredicateSql } from './HistoryArchivePublicSourceScopeSql.js';
import {
	applyHistoryArchiveCheckpointScanPositions,
	applyHistoryArchiveCheckpointScanRanges
} from './HistoryArchiveCheckpointScanCoverageWrite.js';
import {
	checkpointScanSeedSources,
	checkpointScanSeedPositions,
	checkpointScanSeedRanges,
	checkpointScanSeedRowKey,
	isCheckpointScanSeedSource,
	readCheckpointScanSeedPage,
	readCheckpointScanSeedUpperBound,
	type CheckpointScanSeedKey,
	type CheckpointScanSeedSource
} from './HistoryArchiveCheckpointScanSeedSource.js';

export interface CheckpointScanSeedOptions {
	readonly rowLimit?: number;
	readonly statementTimeoutMs?: number;
}
export interface CheckpointScanSeedResult {
	readonly source: CheckpointScanSeedSource | null;
	readonly rowsRead: number;
	readonly evidenceRows: number;
	readonly changedPages: number;
	readonly complete: boolean;
	readonly durableFloorDeficits:
		| readonly {
				readonly archiveUrlIdentity: string;
				readonly scannedCheckpointPositions: string;
				readonly durableVerifiedCheckpointProofs: string;
		  }[]
		| null;
	readonly sources: readonly {
		readonly source: CheckpointScanSeedSource;
		readonly complete: boolean;
	}[];
}
interface SeedStateRow {
	readonly source: unknown;
	readonly cursor: unknown;
	readonly upper_bound: unknown;
	readonly complete: boolean;
}

/** One finite metadata page; no timer, startup hook, or unlimited backfill. */
export async function seedHistoryArchiveCheckpointScanChunk(
	dataSource: DataSource,
	options: CheckpointScanSeedOptions = {}
): Promise<CheckpointScanSeedResult> {
	const rowLimit = boundedInteger(options.rowLimit ?? 1_000, 1, 10_000);
	const statementTimeoutMs = boundedInteger(
		options.statementTimeoutMs ?? 1_500,
		100,
		5_000
	);
	return dataSource.transaction(async (manager) => {
		await manager.query(
			`select set_config('statement_timeout', $1, true),
			 set_config('lock_timeout', '250', true), set_config('jit', 'off', true)`,
			[statementTimeoutMs.toString()]
		);
		await initializeMissingSources(manager);
		const states = await manager.query<SeedStateRow[]>(`
			select source, cursor, upper_bound, complete
			from history_archive_checkpoint_scan_seed_state
			where not complete
			order by case source when 'listings' then 0
				when 'attestations' then 1 when 'events' then 2 else 3 end
			limit 1 for update skip locked
		`);
		const state = states[0];
		if (state === undefined) return result(manager, null, 0, 0, 0);
		if (!isCheckpointScanSeedSource(state.source))
			throw new Error('Unknown checkpoint scan seed source');
		if (state.upper_bound === null)
			throw new Error('Incomplete checkpoint scan seed has no upper boundary');
		const cursor = readKey(state.cursor);
		const upper = readKey(state.upper_bound);
		// One listing range can cover a million positions; materialize only one
		// compressed range per chunk instead of expanding N huge masks at once.
		const pageLimit = state.source === 'listings' ? 1 : rowLimit;
		const page = await readCheckpointScanSeedPage(
			manager,
			state.source,
			cursor,
			upper,
			pageLimit
		);
		const positions = checkpointScanSeedPositions(state.source, page);
		const ranges =
			state.source === 'listings' ? checkpointScanSeedRanges(page) : [];
		const changedPages =
			state.source === 'listings'
				? await applyHistoryArchiveCheckpointScanRanges(manager, ranges)
				: await applyHistoryArchiveCheckpointScanPositions(manager, positions);
		const last = page.at(-1);
		const nextCursor =
			last === undefined
				? cursor
				: checkpointScanSeedRowKey(state.source, last);
		const complete = page.length < pageLimit || keysEqual(nextCursor, upper);
		// OR projection and resumable cursor commit atomically. A failed chunk
		// advances neither; replay cannot increase an already-set checkpoint bit.
		await manager.query(
			`update history_archive_checkpoint_scan_seed_state
			 set cursor=$2::jsonb, complete=$3::boolean, "updatedAt"=now()
			 where source=$1::text`,
			[state.source, JSON.stringify(nextCursor), complete]
		);
		return result(
			manager,
			state.source,
			page.length,
			positions.length + ranges.length,
			changedPages
		);
	});
}

async function initializeMissingSources(manager: EntityManager): Promise<void> {
	const current = await manager.query<SeedStateRow[]>(
		'select source from history_archive_checkpoint_scan_seed_state'
	);
	const known = new Set(current.map((row) => row.source));
	for (const source of checkpointScanSeedSources) {
		if (known.has(source)) continue;
		const upper = await readCheckpointScanSeedUpperBound(manager, source);
		await manager.query(
			`insert into history_archive_checkpoint_scan_seed_state
			 (source, cursor, upper_bound, complete, "updatedAt")
			 values ($1, '{}'::jsonb, $2::jsonb, $3, now())
			 on conflict (source) do nothing`,
			[source, upper === null ? null : JSON.stringify(upper), upper === null]
		);
	}
}

async function result(
	manager: EntityManager,
	source: CheckpointScanSeedSource | null,
	rowsRead: number,
	evidenceRows: number,
	changedPages: number
): Promise<CheckpointScanSeedResult> {
	const rows = await manager.query<SeedStateRow[]>(
		'select source, complete from history_archive_checkpoint_scan_seed_state order by source'
	);
	const sources = rows.map((row) => {
		if (!isCheckpointScanSeedSource(row.source))
			throw new Error('Unknown checkpoint scan seed source');
		return { source: row.source, complete: row.complete };
	});
	const phasesComplete =
		sources.length === checkpointScanSeedSources.length &&
		sources.every((item) => item.complete);
	// Only compact per-root rollups are compared, never proof/queue fact rows.
	// Traversing retained receipts cannot silently undercount known proofs.
	const durableFloorDeficits = phasesComplete
		? await manager.query<
				NonNullable<CheckpointScanSeedResult['durableFloorDeficits']>
			>(`
		select root."archiveUrlIdentity",
			coalesce(scan."scannedCheckpointPositions", 0)::text as "scannedCheckpointPositions",
			durable."durableVerifiedCheckpointProofs"::text as "durableVerifiedCheckpointProofs"
		from (select "archiveUrlIdentity" from history_archive_state_snapshot
			where ${historyArchivePublicSourcePredicateSql}) root
		join history_archive_checkpoint_proof_attestation_rollup durable
			on durable."archiveUrlIdentity" = root."archiveUrlIdentity"
		left join history_archive_checkpoint_scan_summary scan
			on scan."archiveUrlIdentity" = root."archiveUrlIdentity"
		where coalesce(scan."scannedCheckpointPositions", 0) < durable."durableVerifiedCheckpointProofs"
		order by root."archiveUrlIdentity"
	`)
		: null;
	return {
		source,
		rowsRead,
		evidenceRows,
		changedPages,
		sources,
		durableFloorDeficits,
		complete: phasesComplete && durableFloorDeficits?.length === 0
	};
}

function readKey(value: unknown): CheckpointScanSeedKey {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new Error('Invalid checkpoint scan seed cursor');
	const key: Record<string, string | number> = {};
	for (const [field, item] of Object.entries(value)) {
		if (typeof item !== 'string' && typeof item !== 'number')
			throw new Error('Invalid checkpoint scan seed cursor field');
		key[field] = item;
	}
	return key;
}

function keysEqual(
	left: CheckpointScanSeedKey,
	right: CheckpointScanSeedKey
): boolean {
	const fields = Object.keys(right);
	return (
		fields.length === Object.keys(left).length &&
		fields.every((field) => left[field] === right[field])
	);
}

function boundedInteger(
	value: number,
	minimum: number,
	maximum: number
): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
		throw new Error(
			`Scan seed limit must be an integer in [${minimum},${maximum}]`
		);
	return value;
}

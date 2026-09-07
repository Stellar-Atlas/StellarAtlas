import type { EntityManager } from 'typeorm';

export const checkpointScanSeedSources = [
	'listings',
	'attestations',
	'events',
	'queue'
] as const;

export type CheckpointScanSeedSource =
	(typeof checkpointScanSeedSources)[number];
export type CheckpointScanSeedKey = Readonly<Record<string, string | number>>;
export interface CheckpointScanSeedRow {
	readonly id?: string;
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger?: number | string | null;
	readonly firstCheckpointLedger?: number;
	readonly lastCheckpointLedger?: number;
	readonly objectType?: string;
	readonly status?: string;
	readonly eventType?: string;
}
export interface CheckpointScanSeedPosition {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
}
export interface CheckpointScanSeedRange {
	readonly archiveUrlIdentity: string;
	readonly firstCheckpointLedger: number;
	readonly lastCheckpointLedger: number;
}

const categories = new Set([
	'checkpoint-state',
	'ledger',
	'transactions',
	'results',
	'scp'
]);
const terminal = new Set(['verified', 'failed']);
const sourceDefinitions = {
	queue: {
		table: 'history_archive_object_queue',
		fields:
			'id::text, "archiveUrlIdentity", "checkpointLedger", "objectType", status',
		order: 'history_archive_object_queue.id',
		key: 'id'
	},
	events: {
		table: 'history_archive_object_event',
		fields:
			'id::text, "archiveUrlIdentity", "checkpointLedger", "objectType", "eventType"',
		order: 'history_archive_object_event.id',
		key: 'id'
	},
	attestations: {
		table: 'history_archive_checkpoint_proof_attested_checkpoint',
		fields: '"archiveUrlIdentity", "checkpointLedger"',
		order: '"archiveUrlIdentity", "checkpointLedger"',
		key: 'checkpoint'
	},
	listings: {
		table: 'history_archive_listing_gap',
		fields:
			'"archiveUrlIdentity", "firstCheckpointLedger", "lastCheckpointLedger"',
		order:
			'"archiveUrlIdentity", "firstCheckpointLedger", "lastCheckpointLedger"',
		key: 'range'
	}
} as const;

export function isCheckpointScanSeedSource(
	value: unknown
): value is CheckpointScanSeedSource {
	return (
		typeof value === 'string' &&
		checkpointScanSeedSources.some((source) => source === value)
	);
}

export function checkpointScanSeedRowKey(
	source: CheckpointScanSeedSource,
	row: CheckpointScanSeedRow
): CheckpointScanSeedKey {
	if (source === 'queue' || source === 'events') {
		if (typeof row.id !== 'string' || !/^[1-9][0-9]*$/.test(row.id))
			throw new Error('Invalid numeric scan seed key');
		return { id: row.id };
	}
	if (!row.archiveUrlIdentity)
		throw new Error('Invalid archive identity in scan seed key');
	if (source === 'attestations') {
		const checkpoint = Number(row.checkpointLedger);
		if (!Number.isSafeInteger(checkpoint) || checkpoint < 0)
			throw new Error('Invalid checkpoint scan seed key');
		return {
			archiveUrlIdentity: row.archiveUrlIdentity,
			checkpointLedger: checkpoint
		};
	}
	if (
		!Number.isSafeInteger(row.firstCheckpointLedger) ||
		!Number.isSafeInteger(row.lastCheckpointLedger)
	)
		throw new Error('Invalid listing scan seed key');
	return {
		archiveUrlIdentity: row.archiveUrlIdentity,
		firstCheckpointLedger: row.firstCheckpointLedger!,
		lastCheckpointLedger: row.lastCheckpointLedger!
	};
}

export async function readCheckpointScanSeedUpperBound(
	manager: EntityManager,
	source: CheckpointScanSeedSource
): Promise<CheckpointScanSeedKey | null> {
	const definition = sourceDefinitions[source];
	const reverseOrder = definition.order
		.split(', ')
		.map((column) => column + ' desc')
		.join(', ');
	const rows = await manager.query<CheckpointScanSeedRow[]>(
		`select ${definition.fields} from ${definition.table}
		 order by ${reverseOrder} limit 1`
	);
	return rows[0] === undefined
		? null
		: checkpointScanSeedRowKey(source, rows[0]);
}

export async function readCheckpointScanSeedPage(
	manager: EntityManager,
	source: CheckpointScanSeedSource,
	cursor: CheckpointScanSeedKey,
	upper: CheckpointScanSeedKey,
	limit: number
): Promise<CheckpointScanSeedRow[]> {
	const definition = sourceDefinitions[source];
	let predicate: string;
	let parameters: readonly (string | number)[];
	if (definition.key === 'id') {
		predicate = 'id > $1::bigint and id <= $2::bigint';
		parameters = [cursor.id ?? '0', requireKey(upper, 'id'), limit];
	} else if (definition.key === 'checkpoint') {
		predicate = `("archiveUrlIdentity", "checkpointLedger") >
			($1::text, $2::bigint) and
			("archiveUrlIdentity", "checkpointLedger") <= ($3::text, $4::bigint)`;
		parameters = [
			cursor.archiveUrlIdentity ?? '',
			cursor.checkpointLedger ?? -1,
			requireKey(upper, 'archiveUrlIdentity'),
			requireKey(upper, 'checkpointLedger'),
			limit
		];
	} else {
		predicate = `("archiveUrlIdentity", "firstCheckpointLedger", "lastCheckpointLedger") >
			($1::text, $2::integer, $3::integer) and
			("archiveUrlIdentity", "firstCheckpointLedger", "lastCheckpointLedger") <=
			($4::text, $5::integer, $6::integer)`;
		parameters = [
			cursor.archiveUrlIdentity ?? '',
			cursor.firstCheckpointLedger ?? -1,
			cursor.lastCheckpointLedger ?? -1,
			requireKey(upper, 'archiveUrlIdentity'),
			requireKey(upper, 'firstCheckpointLedger'),
			requireKey(upper, 'lastCheckpointLedger'),
			limit
		];
	}
	// Bound the physical numeric/composite PK page BEFORE terminal filtering.
	// Looking for N terminal rows in SQL could walk millions of pending rows.
	return manager.query<CheckpointScanSeedRow[]>(
		`select ${definition.fields} from ${definition.table}
		 where ${predicate} order by ${definition.order}
		 limit $${parameters.length}::integer`,
		[...parameters]
	);
}

export function checkpointScanSeedPositions(
	source: CheckpointScanSeedSource,
	rows: readonly CheckpointScanSeedRow[]
): readonly CheckpointScanSeedPosition[] {
	if (source === 'listings') return [];
	return rows.flatMap((row) => {
		if (
			source !== 'attestations' &&
			(!categories.has(row.objectType ?? '') ||
				!terminal.has(
					source === 'events' ? (row.eventType ?? '') : (row.status ?? '')
				))
		)
			return [];
		const checkpoint = Number(row.checkpointLedger);
		if (!isCheckpoint(checkpoint) || row.checkpointLedger === null) return [];
		if (!row.archiveUrlIdentity)
			throw new Error('Invalid scan seed archive identity');
		return [
			{
				archiveUrlIdentity: row.archiveUrlIdentity,
				checkpointLedger: checkpoint
			}
		];
	});
}

export function checkpointScanSeedRanges(
	rows: readonly CheckpointScanSeedRow[]
): readonly CheckpointScanSeedRange[] {
	return rows.map((row) => {
		const first = row.firstCheckpointLedger;
		const last = row.lastCheckpointLedger;
		if (
			!isCheckpoint(first) ||
			!isCheckpoint(last) ||
			last < first ||
			!row.archiveUrlIdentity
		)
			throw new Error('Invalid retained listing coverage range');
		return {
			archiveUrlIdentity: row.archiveUrlIdentity,
			firstCheckpointLedger: first,
			lastCheckpointLedger: last
		};
	});
}

function isCheckpoint(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 63 &&
		value <= 4_294_967_295 &&
		value % 64 === 63
	);
}

function requireKey(
	key: CheckpointScanSeedKey,
	field: string
): string | number {
	const value = key[field];
	if (typeof value !== 'string' && typeof value !== 'number')
		throw new Error('Missing scan seed boundary field: ' + field);
	return value;
}

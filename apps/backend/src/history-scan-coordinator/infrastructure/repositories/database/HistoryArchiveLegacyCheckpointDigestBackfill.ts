import type { EntityManager } from 'typeorm';
import { canonicalJsonContentDigest } from 'shared/lib/canonical-json-content-digest.js';
import { canonicalCheckpointHasStrictContentDigestSql } from './HistoryArchiveCanonicalCheckpointProofSql.js';
import { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalFrontierSql.js';

interface LegacyCheckpointRow {
	readonly bytesDownloaded: number | string;
	readonly checkpointLedger: number;
	readonly objectUrl: string;
	readonly remoteId: string;
	readonly verificationFacts: unknown;
}

const maximumBackfillRows = 256;

export async function backfillLegacyCheckpointContentDigests(
	manager: EntityManager
): Promise<number> {
	const result: unknown = await manager.query(legacyCheckpointCandidatesSql, [
		maximumBackfillRows
	]);
	const rows = requireLegacyRows(result);
	let updated = 0;
	for (const row of rows) {
		const content = deriveLegacyCheckpointContentDigest(row);
		if (content === null) continue;
		const updateResult: unknown = await manager.query(
			legacyCheckpointDigestUpdateSql,
			[
				row.remoteId,
				JSON.stringify(content),
				JSON.stringify(row.verificationFacts),
				row.bytesDownloaded
			]
		);
		updated += requireUpdatedRows(updateResult);
	}
	return updated;
}

export function deriveLegacyCheckpointContentDigest(
	row: LegacyCheckpointRow
): ReturnType<typeof canonicalJsonContentDigest> | null {
	const facts = readRecord(row.verificationFacts);
	const captured = readRecord(facts?.checkpointHistoryArchiveState);
	const checkpointFact = readRecord(facts?.checkpointHistoryArchiveStateFact);
	const state = readRecord(captured?.stellarHistory);
	if (
		facts === null ||
		captured === null ||
		checkpointFact === null ||
		state === null ||
		captured.stellarHistoryUrl !== row.objectUrl ||
		checkpointFact.stellarHistoryUrl !== row.objectUrl ||
		checkpointFact.checkpointLedger !== row.checkpointLedger
	) {
		return null;
	}
	const serialized = JSON.stringify(state);
	if (
		BigInt(Buffer.byteLength(serialized)) !==
		readDatabaseBigint(row.bytesDownloaded)
	) {
		return null;
	}
	return canonicalJsonContentDigest(state);
}

const legacyCheckpointCandidatesSql = `
	with ${canonicalRuntimeTargetCtes}
	select checkpoint."remoteId", checkpoint."objectUrl",
		checkpoint."checkpointLedger" as "checkpointLedger",
		checkpoint."bytesDownloaded" as "bytesDownloaded",
		checkpoint."verificationFacts" as "verificationFacts"
	from runtime_target target
	join "history_archive_state_snapshot" state
		on state.status = 'available'
		and state."networkPassphrase" is not null
		and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
			target."network_passphrase_hash"
	join "history_archive_object_queue" checkpoint
		on checkpoint."archiveUrlIdentity" = state."archiveUrlIdentity"
		and checkpoint."objectType" = 'checkpoint-state'
		and checkpoint."objectKey" = 'checkpoint-state:' ||
			lpad(to_hex(target.checkpoint_ledger), 8, '0')
		and checkpoint."checkpointLedger" = target.checkpoint_ledger
		and checkpoint.status = 'verified'
	where not coalesce((
		${canonicalCheckpointHasStrictContentDigestSql('checkpoint')}
	), false)
	order by target.target_lane, checkpoint."archiveUrlIdentity"
	limit $1::integer
`;

const legacyCheckpointDigestUpdateSql = `
	update "history_archive_object_queue" candidate
	set "verificationFacts" = jsonb_set(
		candidate."verificationFacts", '{content}', $2::jsonb, true
	)
	where candidate."remoteId" = $1::uuid
		and candidate.status = 'verified'
		and candidate."verificationFacts" = $3::jsonb
		and candidate."bytesDownloaded" = $4::bigint
		and not coalesce((
			${canonicalCheckpointHasStrictContentDigestSql('candidate')}
		), false)
	returning candidate."remoteId"
`;

function requireLegacyRows(value: unknown): readonly LegacyCheckpointRow[] {
	if (!Array.isArray(value))
		throw new Error('Legacy checkpoint query returned no rows');
	const rows: LegacyCheckpointRow[] = [];
	for (const item of value) {
		if (!isLegacyCheckpointRow(item)) {
			throw new Error('Legacy checkpoint query returned an invalid row');
		}
		rows.push(item);
	}
	return rows;
}

function isLegacyCheckpointRow(value: unknown): value is LegacyCheckpointRow {
	const row = readRecord(value);
	if (row === null) return false;
	return (
		(typeof row.bytesDownloaded === 'number' ||
			typeof row.bytesDownloaded === 'string') &&
		Number.isSafeInteger(row.checkpointLedger) &&
		typeof row.objectUrl === 'string' &&
		typeof row.remoteId === 'string'
	);
}

function requireUpdatedRows(value: unknown): number {
	if (!Array.isArray(value))
		throw new Error('Legacy checkpoint update returned no rows');
	return value.length;
}

function readDatabaseBigint(value: number | string): bigint {
	try {
		const parsed = BigInt(value);
		return parsed >= 0n ? parsed : -1n;
	} catch {
		return -1n;
	}
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

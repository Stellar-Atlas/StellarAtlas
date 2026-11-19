import type { FullHistoryLedgerCloseMetaProcessingReceipt } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';

export const RETIRABLE_DERIVED_DATASETS = ['transactions', 'transaction-results', 'operations'] as const;
type Dataset = (typeof RETIRABLE_DERIVED_DATASETS)[number];
export interface DerivedOutputRetirement {
	readonly dataset: Dataset;
	readonly outputSha256: string;
	readonly byteCount: string;
	readonly recordCount: string;
	readonly storageKey: string;
	readonly removed: boolean;
	readonly evidenceSha256: string;
	readonly transformRevision: string;
}
export interface DerivedOutputRecovery {
	readonly version: 1;
	readonly batchId: string;
	readonly networkIdSha256: string;
	readonly startLedger: number;
	readonly endLedger: number;
	readonly manifestSha256: string;
	readonly canonicalSha256: string;
	readonly outputs: readonly DerivedOutputRetirement[];
}
export interface RetirementQuery {
	query(sql: string, parameters?: unknown[]): Promise<unknown>;
}
export type DerivedOutputRecoveryReader = (
	networkHash: Buffer, startLedger: number, endLedger: number
) => Promise<DerivedOutputRecovery | undefined>;

// The separately applied additive schema is the only authority. No table means
// unchanged behavior. A missing file alone never authorizes retirement.
export async function hasDerivedOutputRetirement(query: RetirementQuery): Promise<boolean> {
	const rows = await query.query("select to_regclass('full_history_lcm_derived_output_retirement') is not null as available");
	if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.available !== 'boolean') {
		throw new Error('Invalid derived-output retirement schema result');
	}
	return rows[0].available;
}

export function derivedOutputRecoveryReader(query: RetirementQuery): DerivedOutputRecoveryReader {
	return async (networkHash, startLedger, endLedger) => {
		const plans = await readDerivedOutputRetirements(query, networkHash, { startLedger, endLedger });
		if (plans.length > 1) throw new Error('Multiple retirement authorities for one range');
		return plans[0];
	};
}

export async function readDerivedOutputRetirements(
	query: RetirementQuery, networkHash: Buffer,
	selection: { batchIds: readonly string[] } | { startLedger: number; endLedger: number }
): Promise<readonly DerivedOutputRecovery[]> {
	if (!await hasDerivedOutputRetirement(query)) return [];
	const byId = 'batchIds' in selection;
	const sql = `select b.id::text as "batchId",
		encode(b.network_passphrase_hash,'hex') as "networkIdSha256",
		b.start_ledger::int as "startLedger", b.end_ledger::int as "endLedger",
		encode(b.processing_manifest_sha256,'hex') as "manifestSha256",
		encode(c.output_sha256,'hex') as "canonicalSha256",
		d.dataset, encode(d.output_sha256,'hex') as "outputSha256",
		d.output_bytes::text as "byteCount", d.record_count::text as "recordCount",
		d.storage_key as "storageKey", r.removal_confirmed_at is not null as removed,
		encode(r.evidence_sha256,'hex') as "evidenceSha256", r.transform_revision as "transformRevision"
		from full_history_lcm_derived_output_retirement r
		join full_history_ledger_close_meta_batch b on b.id=r.batch_id
		join full_history_ledger_close_meta_dataset d on d.batch_id=r.batch_id and d.dataset=r.dataset
		join full_history_ledger_close_meta_dataset c on c.batch_id=r.batch_id and c.dataset='ledger-close-meta'
		where b.network_passphrase_hash=$1 and ${byId ? 'b.id=any($2::uuid[])' : 'b.start_ledger=$2 and b.end_ledger=$3'}
		and r.output_sha256=d.output_sha256 and r.canonical_sha256=c.output_sha256
		and r.manifest_sha256=b.processing_manifest_sha256 order by b.id,d.dataset`;
	const raw = await query.query(sql, byId
		? [networkHash, selection.batchIds]
		: [networkHash, selection.startLedger, selection.endLedger]);
	if (!Array.isArray(raw)) throw new Error('Invalid retirement rows');
	const plans = new Map<string, DerivedOutputRecovery>();
	for (const value of raw) {
		if (typeof value !== 'object' || value === null) throw new Error('Invalid retirement row');
		const row = value as Record<string, unknown>;
		const batchId = text(row.batchId);
		if (!/^[0-9a-f-]{36}$/.test(batchId)) throw new Error('Invalid retirement batch');
		const output: DerivedOutputRetirement = {
			dataset: dataset(row.dataset), outputSha256: digest(row.outputSha256),
			byteCount: integer(row.byteCount, true), recordCount: integer(row.recordCount, false),
			storageKey: text(row.storageKey), removed: boolean(row.removed),
			evidenceSha256: digest(row.evidenceSha256), transformRevision: revision(row.transformRevision)
		};
		const plan: DerivedOutputRecovery = {
			version: 1, batchId, networkIdSha256: digest(row.networkIdSha256),
			startLedger: ledger(row.startLedger), endLedger: ledger(row.endLedger),
			manifestSha256: digest(row.manifestSha256), canonicalSha256: digest(row.canonicalSha256),
			outputs: []
		};
		if (plan.endLedger < plan.startLedger || plan.networkIdSha256 !== networkHash.toString('hex')) {
			throw new Error('Invalid retirement range/network');
		}
		const prior = plans.get(batchId);
		if (prior && JSON.stringify({ ...prior, outputs: [] }) !== JSON.stringify(plan)) {
			throw new Error('Conflicting retirement identity');
		}
		const outputs = prior?.outputs ?? [];
		if (outputs.some(item => item.dataset === output.dataset)) throw new Error('Duplicate retirement');
		plans.set(batchId, Object.freeze({ ...plan, outputs: Object.freeze([...outputs, Object.freeze(output)]) }));
	}
	return Object.freeze([...plans.values()]);
}

export function assertDerivedOutputRecovery(
	plan: DerivedOutputRecovery, receipt: Pick<FullHistoryLedgerCloseMetaProcessingReceipt, 'manifestSha256' | 'outputs' | 'range'>,
	networkIdSha256: string
): void {
	const canonical = receipt.outputs.find(output => output.dataset === 'ledger-close-meta');
	if (plan.version !== 1 || plan.networkIdSha256 !== networkIdSha256 ||
		plan.startLedger !== receipt.range.startSequence || plan.endLedger !== receipt.range.endSequence ||
		plan.manifestSha256 !== receipt.manifestSha256 || plan.canonicalSha256 !== canonical?.sha256 ||
		plan.outputs.length < 1 || plan.outputs.length > 3) throw new Error('Retirement recovery identity mismatch');
	const seen = new Set<string>();
	for (const retired of plan.outputs) {
		dataset(retired.dataset); digest(retired.evidenceSha256); revision(retired.transformRevision);
		if (seen.has(retired.dataset)) throw new Error('Duplicate retirement recovery output');
		seen.add(retired.dataset);
		const original = receipt.outputs.find(output => output.dataset === retired.dataset);
		if (!original || original.representation !== 'typed-projection' ||
			original.sha256 !== retired.outputSha256 || String(original.byteCount) !== retired.byteCount ||
			String(original.recordCount) !== retired.recordCount || original.storageKey !== retired.storageKey) {
			throw new Error('Retirement does not bind original output');
		}
	}
}

function text(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid retirement text');
	return value;
}
function digest(value: unknown): string {
	const parsed = text(value);
	if (!/^[0-9a-f]{64}$/.test(parsed)) throw new Error('Invalid retirement digest');
	return parsed;
}
function revision(value: unknown): string {
	const parsed = text(value);
	if (!/^[0-9a-f]{40}$/.test(parsed)) throw new Error('Invalid transform revision');
	return parsed;
}
function integer(value: unknown, positive: boolean): string {
	const parsed = text(value);
	if (!/^(0|[1-9][0-9]*)$/.test(parsed) || (positive && parsed === '0')) throw new Error('Invalid retirement integer');
	return parsed;
}
function ledger(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 4294967295) throw new Error('Invalid retirement ledger');
	return value;
}
function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new Error('Invalid removal confirmation');
	return value;
}
function dataset(value: unknown): Dataset {
	if (!RETIRABLE_DERIVED_DATASETS.includes(value as Dataset)) throw new Error('Dataset cannot be retired');
	return value as Dataset;
}

import type { HistoryArchiveVerifiedCheckpointObjectSource } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	createHistoryArchiveRepairSourceUrlPolicy,
	type HistoryArchiveRepairHostResolver,
	type HistoryArchiveRepairSourceUrlPolicy
} from './HistoryArchiveRepairSourceUrlPolicy.js';
import { mapRepairSourcesWithBoundedConcurrency } from './BoundedRepairSourceMapper.js';

const sha256Pattern = /^[0-9a-f]{64}$/;

type VerifiedSourceRow = {
	readonly anchorKind?: string;
	readonly anchorkind?: string;
	readonly archiveUrl?: string;
	readonly archiveurl?: string;
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly candidateRemoteId?: string;
	readonly candidateremoteid?: string;
	readonly checkpointLedger?: number | string;
	readonly checkpointledger?: number | string;
	readonly contentDigest?: string;
	readonly contentdigest?: string;
	readonly contentRepresentation?: string;
	readonly contentrepresentation?: string;
	readonly corroboratingSourceCount?: number | string;
	readonly corroboratingsourcecount?: number | string;
	readonly objectUrl?: string;
	readonly objecturl?: string;
	readonly proofEvaluatedAt?: Date | string;
	readonly proofevaluatedat?: Date | string;
	readonly proofId?: number | string;
	readonly proofid?: number | string;
	readonly proofVersion?: number | string;
	readonly proofversion?: number | string;
	readonly targetRemoteId?: string;
	readonly targetremoteid?: string;
	readonly verifiedAt?: Date | string;
	readonly verifiedat?: Date | string;
};

export async function mapVerifiedCheckpointSourceRows(
	value: unknown,
	hostResolver?: HistoryArchiveRepairHostResolver
): Promise<readonly HistoryArchiveVerifiedCheckpointObjectSource[]> {
	const policy = createHistoryArchiveRepairSourceUrlPolicy(hostResolver);
	const candidates = await mapRepairSourcesWithBoundedConcurrency(
		requireRows(value),
		(row) => mapRow(row, policy).catch(() => null)
	);
	return candidates.filter(isPresent);
}

function requireRows(value: unknown): readonly VerifiedSourceRow[] {
	if (!Array.isArray(value)) {
		throw new Error('Verified checkpoint source query did not return rows');
	}
	const rows: VerifiedSourceRow[] = [];
	for (const item of value as unknown[]) {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) {
			throw new Error(
				'Verified checkpoint source query returned an invalid row'
			);
		}
		rows.push(item);
	}
	return rows;
}

async function mapRow(
	row: VerifiedSourceRow,
	urlPolicy: HistoryArchiveRepairSourceUrlPolicy
): Promise<HistoryArchiveVerifiedCheckpointObjectSource> {
	const archiveUrl = requireString(
		row.archiveUrl ?? row.archiveurl,
		'archiveUrl'
	);
	const archiveUrlIdentity = requireString(
		row.archiveUrlIdentity ?? row.archiveurlidentity,
		'archiveUrlIdentity'
	);
	return {
		anchorKind: requireAnchorKind(row.anchorKind ?? row.anchorkind),
		archiveUrl,
		archiveUrlIdentity,
		candidateRemoteId: requireUuid(
			row.candidateRemoteId ?? row.candidateremoteid,
			'candidateRemoteId'
		),
		checkpointLedger: requireLedger(
			row.checkpointLedger ?? row.checkpointledger
		),
		contentDigest: requireDigest(row.contentDigest ?? row.contentdigest),
		contentRepresentation: requireRepresentation(
			row.contentRepresentation ?? row.contentrepresentation
		),
		corroboratingSourceCount: requirePositiveInteger(
			row.corroboratingSourceCount ?? row.corroboratingsourcecount,
			'corroboratingSourceCount'
		),
		objectUrl: await urlPolicy.requireObjectUrl(
			row.objectUrl ?? row.objecturl,
			archiveUrl,
			archiveUrlIdentity
		),
		proofEvaluatedAt: requireDate(
			row.proofEvaluatedAt ?? row.proofevaluatedat,
			'proofEvaluatedAt'
		),
		proofId: requirePositiveInteger(row.proofId ?? row.proofid, 'proofId'),
		proofVersion: requirePositiveInteger(
			row.proofVersion ?? row.proofversion,
			'proofVersion'
		),
		targetRemoteId: requireUuid(
			row.targetRemoteId ?? row.targetremoteid,
			'targetRemoteId'
		),
		verifiedAt: requireDate(row.verifiedAt ?? row.verifiedat, 'verifiedAt')
	};
}

function isPresent<T>(value: T | null): value is T {
	return value !== null;
}

function requireAnchorKind(
	value: string | undefined
): 'multi-source' | 'target-digest' {
	if (value === 'multi-source' || value === 'target-digest') return value;
	throw new Error('Verified checkpoint source row has invalid anchorKind');
}

function requireString(value: string | undefined, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Verified checkpoint source row is missing ${field}`);
}

function requireUuid(value: string | undefined, field: string): string {
	const uuid = requireString(value, field);
	if (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			uuid
		)
	) {
		return uuid;
	}
	throw new Error(`Verified checkpoint source row has invalid ${field}`);
}

function requireLedger(value: number | string | undefined): number {
	const ledger = typeof value === 'number' ? value : Number(value);
	if (Number.isSafeInteger(ledger) && ledger >= 0) return ledger;
	throw new Error(
		'Verified checkpoint source row has invalid checkpointLedger'
	);
}

function requireDigest(value: string | undefined): string {
	const digest = requireString(value, 'contentDigest').toLowerCase();
	if (sha256Pattern.test(digest)) return digest;
	throw new Error('Verified checkpoint source row has invalid contentDigest');
}

function requireRepresentation(
	value: string | undefined
): 'canonical-json' | 'uncompressed-xdr' {
	if (value === 'canonical-json' || value === 'uncompressed-xdr') return value;
	throw new Error(
		'Verified checkpoint source row has invalid contentRepresentation'
	);
}

function requireDate(value: Date | string | undefined, field: string): Date {
	const date = value instanceof Date ? value : new Date(value ?? '');
	if (!Number.isNaN(date.getTime())) return date;
	throw new Error(`Verified checkpoint source row has invalid ${field}`);
}

function requirePositiveInteger(
	value: number | string | undefined,
	field: string
): number {
	const number = typeof value === 'number' ? value : Number(value);
	if (Number.isSafeInteger(number) && number > 0) return number;
	throw new Error(`Verified checkpoint source row has invalid ${field}`);
}

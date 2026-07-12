import type { EntityManager, Repository } from 'typeorm';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectType } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import {
	historyArchiveConsumerCount,
	historyArchivePerHostConcurrency,
	historyArchivePerRootFrontier
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import {
	historyArchiveObjectClaimAdoptionSql,
	historyArchiveObjectClaimCleanupSql,
	historyArchiveObjectClaimFallbackLockSql,
	historyArchiveObjectClaimFinalizeSql,
	historyArchiveObjectClaimSelectionSql
} from './HistoryArchiveObjectClaimSql.js';
import {
	createObjectFromRow,
	extractRows,
	type RawObjectQueryResult
} from './HistoryArchiveObjectRowMapper.js';

export type HistoryArchiveObjectClaimAttempt =
	| { readonly outcome: 'claimed'; readonly object: HistoryArchiveObject }
	| { readonly outcome: 'contended' | 'idle' };

type ClaimSelection =
	| { readonly outcome: 'contended' | 'idle' }
	| {
			readonly outcome: 'selected';
			readonly slot: number;
			readonly rootId: number | string;
			readonly archiveUrlIdentity: string;
			readonly hostIdentity: string;
			readonly claimClass: 'failed' | 'pending';
	  };

const transactionSettingsSql = `
	set local jit = off;
	set local lock_timeout = '5s'
`;

export async function claimHistoryArchiveObject(
	repository: Repository<HistoryArchiveObject>,
	supportedTypes: readonly HistoryArchiveObjectType[]
): Promise<HistoryArchiveObject | null> {
	return await claimWithBoundedContentionFallback(
		() => runClaimAttempt(repository, supportedTypes, false),
		() => runClaimAttempt(repository, supportedTypes, true)
	);
}

export async function claimWithBoundedContentionFallback(
	fastClaim: () => Promise<HistoryArchiveObjectClaimAttempt>,
	fallbackClaim: () => Promise<HistoryArchiveObjectClaimAttempt>
): Promise<HistoryArchiveObject | null> {
	const fast = await fastClaim();
	if (fast.outcome === 'claimed') return fast.object;
	if (fast.outcome !== 'contended') return null;

	const fallback = await fallbackClaim();
	return fallback.outcome === 'claimed' ? fallback.object : null;
}

async function runClaimAttempt(
	repository: Repository<HistoryArchiveObject>,
	supportedTypes: readonly HistoryArchiveObjectType[],
	exclusiveGate: boolean
): Promise<HistoryArchiveObjectClaimAttempt> {
	return await repository.manager.transaction(async (manager) => {
		await manager.query(transactionSettingsSql);
		if (exclusiveGate) {
			await manager.query(historyArchiveObjectClaimFallbackLockSql);
		}
		const cleanup = requireResultRow(
			(await manager.query(historyArchiveObjectClaimCleanupSql, [
				exclusiveGate
			])) as unknown,
			'cleanup'
		);
		if (!requireBoolean(cleanup.locked, 'cleanup.locked')) {
			return { outcome: 'contended' };
		}
		const adoption = requireResultRow(
			(await manager.query(historyArchiveObjectClaimAdoptionSql, [
				historyArchiveConsumerCount
			])) as unknown,
			'adoption'
		);
		if (
			!requireBoolean(adoption.locked, 'adoption.locked') ||
			requireCount(
				adoption.untrackedObjects ?? adoption.untrackedobjects,
				'adoption.untrackedObjects'
			) !==
				requireCount(
					adoption.adoptedObjects ?? adoption.adoptedobjects,
					'adoption.adoptedObjects'
				)
		) {
			return { outcome: 'contended' };
		}

		const selection = await selectClaim(manager, supportedTypes);
		if (selection.outcome !== 'selected') return selection;

		const rows = extractRows(
			(await manager.query(historyArchiveObjectClaimFinalizeSql, [
				[...supportedTypes],
				historyArchivePerRootFrontier,
				selection.slot,
				historyArchivePerHostConcurrency,
				selection.rootId,
				selection.archiveUrlIdentity,
				selection.hostIdentity,
				selection.claimClass
			])) as RawObjectQueryResult
		);
		const row = rows[0];
		return row === undefined
			? { outcome: 'contended' }
			: { object: createObjectFromRow(row), outcome: 'claimed' };
	});
}

async function selectClaim(
	manager: EntityManager,
	supportedTypes: readonly HistoryArchiveObjectType[]
): Promise<ClaimSelection> {
	const result = (await manager.query(historyArchiveObjectClaimSelectionSql, [
		[...supportedTypes],
		historyArchivePerRootFrontier,
		historyArchiveConsumerCount,
		historyArchivePerHostConcurrency
	])) as unknown;
	const row = extractUnknownRows(result)[0];
	if (!isRecord(row)) {
		throw new Error('History archive claim selection returned no outcome');
	}

	const outcome = row.outcome;
	if (outcome === 'contended' || outcome === 'idle') return { outcome };
	if (outcome !== 'selected') {
		throw new Error(
			'History archive claim selection returned an invalid outcome'
		);
	}

	return {
		archiveUrlIdentity: requireString(
			row.archiveUrlIdentity ?? row.archiveurlidentity,
			'archiveUrlIdentity'
		),
		claimClass: requireClaimClass(
			row.claimClass ?? row.claimclass,
			'claimClass'
		),
		hostIdentity: requireString(
			row.hostIdentity ?? row.hostidentity,
			'hostIdentity'
		),
		outcome,
		rootId: requireInteger(row.rootId ?? row.rootid, 'rootId'),
		slot: Number(requireInteger(row.slot, 'slot'))
	};
}

function requireResultRow(
	result: unknown,
	phase: string
): Record<string, unknown> {
	const row = extractUnknownRows(result)[0];
	if (isRecord(row)) return row;
	throw new Error(`History archive claim ${phase} returned no outcome`);
}

function extractUnknownRows(result: unknown): readonly unknown[] {
	if (Array.isArray(result)) {
		if (
			result.length === 2 &&
			Array.isArray(result[0]) &&
			typeof result[1] === 'number'
		) {
			return result[0];
		}
		return result;
	}
	if (isRecord(result)) {
		if (Array.isArray(result.raw)) return result.raw;
		if (Array.isArray(result.records)) return result.records;
	}
	throw new Error('History archive claim query returned an unsupported result');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function requireInteger(value: unknown, field: string): number | string {
	if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
	if (typeof value === 'string' && /^\d+$/.test(value)) return value;
	throw new Error(`History archive claim selection has invalid ${field}`);
}

function requireCount(value: unknown, field: string): number {
	const integer = requireInteger(value, field);
	return Number(integer);
}

function requireBoolean(value: unknown, field: string): boolean {
	if (typeof value === 'boolean') return value;
	throw new Error(`History archive claim selection has invalid ${field}`);
}

function requireString(value: unknown, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`History archive claim selection has invalid ${field}`);
}

function requireClaimClass(
	value: unknown,
	field: string
): 'failed' | 'pending' {
	if (value === 'failed' || value === 'pending') return value;
	throw new Error(`History archive claim selection has invalid ${field}`);
}

import type { DataSource } from 'typeorm';
import { excludedHistoryArchiveHosts } from '../../../domain/history-archive-object/HistoryArchiveScanPolicy.js';
import type {
	ArchiveBrokerRamCandidate,
	ArchiveBrokerRamContext
} from '../../cli/archive-broker/ArchiveBrokerRamTypes.js';
import {
	historyArchiveRamContextSql,
	historyArchiveRamRefreshIdsSql,
	historyArchiveRamSnapshotPageSql,
	historyArchiveRamRootPageSql,
	historyArchiveRamWindowPageSql
} from './HistoryArchiveRamCandidateFeedSql.js';
import { getCanonicalFrontierAlternateTargets } from './HistoryArchiveCanonicalFallbackTargets.js';
import { ramTime, ramTimestamp } from '../../cli/archive-broker/ArchiveBrokerRamEligibility.js';

export interface HistoryArchiveRamCandidatePage {
	readonly rows: readonly ArchiveBrokerRamCandidate[];
	readonly nextCursor: string | null;
	readonly hasMore: boolean;
}

export interface HistoryArchiveRamRootPage {
	readonly roots: readonly string[];
	readonly nextCursor: string | null;
	readonly hasMore: boolean;
}

export interface HistoryArchiveRamWindowCursor {
	readonly priority: number;
	readonly updatedAtUs: string;
	readonly remoteId: string;
}

export interface HistoryArchiveRamWindowPage {
	readonly rows: readonly ArchiveBrokerRamCandidate[];
	readonly nextCursor: HistoryArchiveRamWindowCursor | null;
	readonly hasMore: boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuid(value: string): string {
	if (!uuid.test(value)) throw new Error('Invalid RAM candidate identity');
	return value.toLowerCase();
}
function requireRoot(value: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 4096)
		throw new Error('Invalid RAM candidate root');
	return value;
}
function fresh(row: ArchiveBrokerRamCandidate): boolean {
	return (
		row.status === 'pending' &&
		(row.attempts === 0 || row.proofCompletionReserve === true) &&
		typeof row.hostIdentity === 'string' &&
		typeof row.objectType === 'string'
	);
}

/** Rebuildable read model. No method creates jobs, hydrates projections, or
 * writes evidence. Missing IDs in refresh results mean removal from RAM. */
export class HistoryArchiveRamCandidateFeed {
	constructor(private readonly dataSource: Pick<DataSource, 'query'>) {}

	async listRootPage(afterRoot: string | null, limit = 8): Promise<HistoryArchiveRamRootPage> {
		if (!Number.isInteger(limit) || limit < 1 || limit > 32)
			throw new Error('RAM root page limit must be between 1 and 32');
		const rows = await this.dataSource.query<{ archiveUrlIdentity: string }[]>(
			historyArchiveRamRootPageSql, [afterRoot === null ? null : requireRoot(afterRoot), limit + 1]
		);
		const roots = rows.slice(0, limit).map((row) => row.archiveUrlIdentity);
		return { roots, nextCursor: roots.at(-1) ?? null, hasMore: rows.length > limit };
	}

	async windowPage(
		root: string, cursor: HistoryArchiveRamWindowCursor | null, limit = 128
	): Promise<HistoryArchiveRamWindowPage> {
		if (!Number.isInteger(limit) || limit < 1 || limit > 128)
			throw new Error('RAM window page limit must be between 1 and 128');
		if (cursor !== null && (!Number.isInteger(cursor.priority) || cursor.priority < 0 || cursor.priority > 2 ||
			typeof cursor.updatedAtUs !== 'string' || cursor.updatedAtUs.length > 21))
			throw new Error('Invalid RAM window cursor');
		const rows = await this.dataSource.query<ArchiveBrokerRamCandidate[]>(historyArchiveRamWindowPageSql, [
			requireRoot(root), cursor?.priority ?? -1,
			cursor === null ? '1970-01-01T00:00:00.000000Z' : ramTimestamp(ramTime(cursor.updatedAtUs)),
			cursor === null ? '00000000-0000-0000-0000-000000000000' : requireUuid(cursor.remoteId), limit
		]);
		const last = rows.at(-1);
		return {
			rows: rows.filter(fresh),
			nextCursor: last === undefined ? null : {
				priority: last.priority, updatedAtUs: last.updatedAtUs, remoteId: last.remoteId
			},
			hasMore: rows.length === limit
		};
	}

	async snapshotPage(
		afterRemoteId: string | null,
		limit = 512
	): Promise<HistoryArchiveRamCandidatePage> {
		if (!Number.isInteger(limit) || limit < 1 || limit > 512)
			throw new Error('RAM snapshot page limit must be between1 and512');
		const rows = await this.dataSource.query<ArchiveBrokerRamCandidate[]>(
			historyArchiveRamSnapshotPageSql,
			[afterRemoteId === null ? null : requireUuid(afterRemoteId), limit]
		);
		return {
			rows: rows.filter(fresh),
			nextCursor: rows.at(-1)?.remoteId ?? null,
			hasMore: rows.length === limit
		};
	}

	async refreshIds(
		ids: readonly string[]
	): Promise<readonly ArchiveBrokerRamCandidate[]> {
		if (ids.length > 128)
			throw new Error('RAM identity refresh exceeds128 IDs');
		if (ids.length === 0) return [];
		const rows = await this.dataSource.query<ArchiveBrokerRamCandidate[]>(
			historyArchiveRamRefreshIdsSql,
			[[...new Set(ids.map(requireUuid))]]
		);
		return rows.filter(fresh);
	}

	async loadContext(
		canonicalRoot: string | null,
		roots: readonly string[] = []
	): Promise<ArchiveBrokerRamContext> {
		const fallbackTargets = await getCanonicalFrontierAlternateTargets({
			query: (sql, parameters) => this.dataSource.query(sql, parameters)
		});
		const [context] = await this.dataSource.query<
			Omit<
				ArchiveBrokerRamContext,
				'canonicalRoot' | 'excludedHosts' | 'excludedRoots'
			>[]
		>(historyArchiveRamContextSql, [
			canonicalRoot,
			[...new Set(roots)],
			JSON.stringify(fallbackTargets)
		]);
		if (context === undefined)
			throw new Error('RAM scheduling context unavailable');
		return {
			...context,
			canonicalRoot,
			excludedHosts: excludedHistoryArchiveHosts(),
			excludedRoots: []
		};
	}
}

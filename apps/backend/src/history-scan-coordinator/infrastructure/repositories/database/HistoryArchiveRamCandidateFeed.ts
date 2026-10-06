import type { DataSource } from 'typeorm';
import { excludedHistoryArchiveHosts } from '../../../domain/history-archive-object/HistoryArchiveScanPolicy.js';
import type {
	ArchiveBrokerRamCandidate,
	ArchiveBrokerRamContext
} from '../../cli/archive-broker/ArchiveBrokerRamTypes.js';
import {
	historyArchiveRamContextSql,
	historyArchiveRamRefreshIdsSql,
	historyArchiveRamSnapshotPageSql
} from './HistoryArchiveRamCandidateFeedSql.js';

export interface HistoryArchiveRamCandidatePage {
	readonly rows: readonly ArchiveBrokerRamCandidate[];
	readonly nextCursor: string | null;
	readonly hasMore: boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuid(value: string): string {
	if (!uuid.test(value)) throw new Error('Invalid RAM candidate identity');
	return value.toLowerCase();
}
function fresh(row: ArchiveBrokerRamCandidate): boolean {
	return (
		row.status === 'pending' &&
		row.attempts === 0 &&
		typeof row.hostIdentity === 'string' &&
		typeof row.objectType === 'string'
	);
}

/** Rebuildable read model. No method creates jobs, hydrates projections, or
 * writes evidence. Missing IDs in refresh results mean removal from RAM. */
export class HistoryArchiveRamCandidateFeed {
	constructor(private readonly dataSource: Pick<DataSource, 'query'>) {}

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
		const [context] = await this.dataSource.query<
			Omit<
				ArchiveBrokerRamContext,
				'canonicalRoot' | 'excludedHosts' | 'excludedRoots'
			>[]
		>(historyArchiveRamContextSql, [canonicalRoot, [...new Set(roots)]]);
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

'use client';

import type { PublicHistoryArchiveStatusSummary } from '@api/types';
import { formatInteger } from '@format/formatters';
import { formatArchiveSourceLabel } from './archive-status-formatters';
import { getStatusTablePage, StatusTablePagination } from './status-table-pagination';
import { useState } from 'react';

type ArchiveSource = PublicHistoryArchiveStatusSummary['sources'][number];

export function getArchiveRootProgress(source: ArchiveSource): {
	readonly expected: number;
	readonly verified: number;
	readonly scanned: number;
	readonly scanStatus: 'reconciling' | 'complete';
} {
	const knownLedgers = [
		source.currentLedger,
		source.latestCheckpointLedger,
		source.latestDiscoveredCheckpointLedger
	].filter((ledger): ledger is number => ledger !== null);
	const latestKnownLedger =
		knownLedgers.length === 0 ? null : Math.max(...knownLedgers);
	return {
		expected:
			latestKnownLedger === null || latestKnownLedger < 63
				? 0
				: Math.floor((latestKnownLedger + 1) / 64),
		verified: source.durableVerifiedCheckpointProofs,
		scanned: source.scanCoverage?.scannedCheckpointPositions ?? 0,
		scanStatus: source.scanCoverage?.status ?? 'reconciling'
	};
}

export function ArchiveRootProgressTable({
	sources
}: {
	readonly sources: readonly ArchiveSource[];
}): React.JSX.Element {
	const [page, setPage] = useState(0);
	const currentPage = getStatusTablePage(sources, page, 10);
	return (
		<div className="archive-root-progress">
			<div className="responsive-table">
				<table className="archive-root-progress-table">
					<thead>
						<tr>
							<th>Archive root</th>
							<th>Durable verified evidence</th>
							<th>Scanned positions</th>
							<th>Current checks</th>
						</tr>
					</thead>
					<tbody>
						{currentPage.rows.length === 0 ? (
							<tr><td colSpan={4}>No archive roots captured.</td></tr>
						) : currentPage.rows.map((source) => {
							const progress = getArchiveRootProgress(source);
							const maximum = Math.max(1, progress.expected);
							return (
								<tr key={source.archiveUrlIdentity}>
									<th scope="row">{formatArchiveSourceLabel(source.archiveUrl)}</th>
									<td>
										<progress
										aria-label={`Durable verified checkpoint evidence for ${source.archiveUrl}`}
											max={maximum}
											value={Math.min(progress.verified, maximum)}
										/>
										<span>
											{formatInteger(progress.verified)} / {formatInteger(progress.expected)} durable verified
										</span>
									</td>
									<td>
										<progress
										aria-label={`Scanned checkpoint positions for ${source.archiveUrl}`}
											max={maximum}
											value={Math.min(progress.scanned, maximum)}
										/>
										<span>
											{formatInteger(progress.scanned)} / {formatInteger(progress.expected)} scanned
											{progress.scanStatus === 'reconciling' ? ' · reconciling' : ''}
										</span>
									</td>
									<td>
										{formatInteger(source.activeObjectChecks)} active ·{' '}
											{formatInteger(source.pendingCheckpointProofs)} waiting ·{' '}
											{formatInteger(source.notEvaluableCheckpointProofs)} incomplete
										</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<StatusTablePagination
				label="Archive root progress pages"
				onPageChange={setPage}
				page={currentPage.page}
				pageSize={10}
				totalRows={sources.length}
			/>
		</div>
	);
}

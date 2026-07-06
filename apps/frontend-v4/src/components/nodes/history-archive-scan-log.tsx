'use client';

import { useMemo, useState } from 'react';
import type { PublicHistoryArchiveScanLogEntry } from '../../api/types';
import { formatInteger } from '../../format/formatters';
import {
	getArchiveVerificationErrors,
	getWorkerIssues,
	scanLogHasArchiveVerificationError,
	scanLogHasWorkerIssue,
	scanLogIsActive
} from '../../domain/history-archive';
import {
	ScanLogDetails,
	dedupeScanLogs,
	formatRowTimestamp,
	getRowPresentation,
	getScanLogRenderKey
} from './history-archive-scan-log-details';

interface HistoryArchiveScanLogProps {
	readonly logs: readonly PublicHistoryArchiveScanLogEntry[];
}

type ScanLogFilter =
	| 'attention'
	| 'active'
	| 'completed'
	| 'archive-errors'
	| 'worker-issues'
	| 'all';

const archiveScanLogItemStyle = {
	background: 'var(--panel)',
	borderColor: 'var(--border)',
	color: 'var(--ink)'
};

const segmentedControlStyle = {
	flexWrap: 'wrap',
	maxWidth: '100%',
	overflow: 'visible'
} as const;

export function HistoryArchiveScanLog({
	logs
}: HistoryArchiveScanLogProps): React.JSX.Element {
	const [filter, setFilter] = useState<ScanLogFilter>('attention');
	const dedupedLogs = useMemo(() => dedupeScanLogs(logs), [logs]);
	const hiddenDuplicateCount = logs.length - dedupedLogs.length;
	const filteredLogs = useMemo(
		() =>
			dedupedLogs.filter((entry) => {
				if (filter === 'attention') {
					return (
						scanLogIsActive(entry) ||
						scanLogHasArchiveVerificationError(entry) ||
						scanLogHasWorkerIssue(entry)
					);
				}
				if (filter === 'active') return scanLogIsActive(entry);
				if (filter === 'completed') return !scanLogIsActive(entry);
				if (filter === 'archive-errors') {
					return scanLogHasArchiveVerificationError(entry);
				}
				if (filter === 'worker-issues') return scanLogHasWorkerIssue(entry);

				return true;
			}),
		[dedupedLogs, filter]
	);
	const archiveErrorCount = dedupedLogs.filter(
		scanLogHasArchiveVerificationError
	).length;
	const workerIssueCount = dedupedLogs.filter(scanLogHasWorkerIssue).length;
	const successfulRunCount = dedupedLogs.filter(scanLogIsSuccessfulRun).length;
	const activeCount = dedupedLogs.filter(scanLogIsActive).length;
	const completedCount = dedupedLogs.length - activeCount;

	if (dedupedLogs.length === 0) {
		return (
			<p className="muted-copy">No archive scan jobs are available yet.</p>
		);
	}

	return (
		<div className="archive-scan-log">
			<div className="archive-scan-log-toolbar">
				<div>
					<strong>{formatInteger(dedupedLogs.length)}</strong>
					<span> unique scan rows</span>
					<span className="muted-inline">
						{' '}
						/ {formatInteger(activeCount)} active /{' '}
						{formatInteger(completedCount)} completed /{' '}
						{formatInteger(archiveErrorCount)} archive errors /{' '}
						{formatInteger(workerIssueCount)} worker issues /{' '}
						{formatInteger(successfulRunCount)} successful runs
					</span>
					{hiddenDuplicateCount > 0 ? (
						<span className="muted-inline">
							{' '}
							/ {formatInteger(hiddenDuplicateCount)} duplicate active rows
							hidden
						</span>
					) : null}
				</div>
				<div
					className="segmented"
					aria-label="Archive scan log filter"
					style={segmentedControlStyle}
				>
					<button
						className={filter === 'attention' ? 'active' : ''}
						onClick={() => setFilter('attention')}
						type="button"
					>
						Attention
					</button>
					<button
						className={filter === 'active' ? 'active' : ''}
						onClick={() => setFilter('active')}
						type="button"
					>
						Queue
					</button>
					<button
						className={filter === 'completed' ? 'active' : ''}
						onClick={() => setFilter('completed')}
						type="button"
					>
						Evidence
					</button>
					<button
						className={filter === 'archive-errors' ? 'active' : ''}
						onClick={() => setFilter('archive-errors')}
						type="button"
					>
						Archive errors
					</button>
					<button
						className={filter === 'worker-issues' ? 'active' : ''}
						onClick={() => setFilter('worker-issues')}
						type="button"
					>
						Worker issues
					</button>
					<button
						className={filter === 'all' ? 'active' : ''}
						onClick={() => setFilter('all')}
						type="button"
					>
						All
					</button>
				</div>
			</div>
			{filteredLogs.length === 0 ? (
				<p className="muted-copy">{getEmptyFilterMessage(filter)}</p>
			) : (
				<ul className="archive-scan-log-list">
					{filteredLogs.map((entry, index) => {
						const isActive = scanLogIsActive(entry);
						const archiveErrors = getArchiveVerificationErrors(entry.errors);
						const workerIssues = getWorkerIssues(entry.errors);
						const hasArchiveErrors = archiveErrors.length > 0;
						const hasWorkerIssues =
							workerIssues.length > 0 ||
							(entry.errors.length === 0 && entry.hasWorkerIssue === true);
						const row = getRowPresentation(
							entry,
							hasArchiveErrors,
							hasWorkerIssues
						);

						return (
							<li
								className={row.tone}
								key={getScanLogRenderKey(entry, index)}
								style={archiveScanLogItemStyle}
							>
								<div className="archive-scan-log-row">
									<div>
										<strong>{row.title}</strong>
										<span>{formatRowTimestamp(entry)}</span>
									</div>
									<span className={getRowTagClassName(row.tone)}>
										{row.tag}
									</span>
								</div>
								<dl className="archive-scan-log-metrics">
									<div>
										<dt>Verified</dt>
										<dd>{formatInteger(entry.latestVerifiedLedger)}</dd>
									</div>
									<div>
										<dt>Scanned</dt>
										<dd>{formatInteger(entry.latestScannedLedger)}</dd>
									</div>
									<div>
										<dt>Range</dt>
										<dd>{formatRange(entry)}</dd>
									</div>
									<div>
										<dt>Concurrency</dt>
										<dd>{formatConcurrency(entry)}</dd>
									</div>
									<div>
										<dt>Duration</dt>
										<dd>{formatDuration(entry)}</dd>
									</div>
								</dl>
								<ScanLogDetails
									archiveErrors={archiveErrors}
									entry={entry}
									isActive={isActive}
									workerIssues={workerIssues}
								/>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

const scanLogIsSuccessfulRun = (
	entry: PublicHistoryArchiveScanLogEntry
): boolean =>
	entry.status === 'completed' &&
	!scanLogIsActive(entry) &&
	!scanLogHasArchiveVerificationError(entry) &&
	!scanLogHasWorkerIssue(entry);

const getEmptyFilterMessage = (filter: ScanLogFilter): string => {
	if (filter === 'attention') {
		return 'No active scan runs, archive verification errors, or worker issues are recorded for this archive.';
	}
	if (filter === 'active') {
		return 'No active scan runs are recorded for this archive right now.';
	}
	if (filter === 'completed') {
		return 'No completed scan evidence is recorded for this archive yet.';
	}
	if (filter === 'archive-errors') {
		return 'No current archive verification errors match this filter.';
	}
	if (filter === 'worker-issues') {
		return 'No worker infrastructure issues match this filter.';
	}

	return 'No archive scan runs are available for this filter.';
};

const formatRange = (entry: PublicHistoryArchiveScanLogEntry): string => {
	if (
		entry.status === 'queued' &&
		entry.fromLedger === 0 &&
		entry.toLedger === null
	) {
		return 'awaiting target range';
	}

	return `${formatInteger(entry.fromLedger)} - ${
		entry.toLedger === null ? 'latest' : formatInteger(entry.toLedger)
	}`;
};

const formatConcurrency = (entry: PublicHistoryArchiveScanLogEntry): string => {
	if (entry.status === 'queued') return 'waiting for worker';
	if (entry.status === 'stale' && entry.concurrency === null) {
		return 'worker heartbeat stale';
	}
	if (entry.concurrency === null) return 'starting';

	return formatInteger(entry.concurrency);
};

const formatDuration = (entry: PublicHistoryArchiveScanLogEntry): string => {
	if (entry.status === 'queued') return 'not started';
	const durationMs = entry.durationMs;
	if (!Number.isFinite(durationMs) || durationMs < 0) return 'Unknown';
	if (scanLogIsActive(entry) && durationMs === 0) return 'in progress';
	if (durationMs < 1000) return `${Math.round(durationMs)} ms`;

	const durationSeconds = Math.round(durationMs / 1000);
	if (durationSeconds < 60) return `${durationSeconds}s`;

	const minutes = Math.floor(durationSeconds / 60);
	const seconds = durationSeconds % 60;
	return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
};

const getRowTagClassName = (rowTone: string): string => {
	if (rowTone === 'has-error') return 'tag warning';
	if (rowTone === 'is-active') return 'tag active';

	return 'tag good';
};

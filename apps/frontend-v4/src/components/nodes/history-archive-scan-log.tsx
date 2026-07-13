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
	const [page, setPage] = useState(0);
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
	const cleanCompletedRunCount = dedupedLogs.filter(
		scanLogIsCleanCompletedRun
	).length;
	const activeCount = dedupedLogs.filter(scanLogIsActive).length;
	const completedCount = dedupedLogs.length - activeCount;
	const pageCount = Math.max(
		1,
		Math.ceil(filteredLogs.length / RANGE_PAGE_SIZE)
	);
	const safePage = Math.min(page, pageCount - 1);
	const visibleLogs = filteredLogs.slice(
		safePage * RANGE_PAGE_SIZE,
		(safePage + 1) * RANGE_PAGE_SIZE
	);
	const selectFilter = (nextFilter: ScanLogFilter): void => {
		setFilter(nextFilter);
		setPage(0);
	};

	if (dedupedLogs.length === 0) {
		return (
			<details className="metadata-document legacy-range-evidence">
				<summary>
					<span>Historical range-scan evidence</span>
					<span className="muted-inline">0 retained rows</span>
				</summary>
				<p className="muted-copy">
					No historical range-scan rows are available.
				</p>
			</details>
		);
	}

	return (
		<details className="metadata-document legacy-range-evidence">
			<summary>
				<span>Historical range-scan evidence</span>
				<span className="muted-inline">
					{formatInteger(dedupedLogs.length)} retained rows
				</span>
			</summary>
			<p className="muted-copy">
				These legacy range rows are retained for historical review only. They do
				not represent current archive health, object work, or scanner runtime.
			</p>
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
							{formatInteger(cleanCompletedRunCount)} clean runs
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
							aria-pressed={filter === 'attention'}
							className={filter === 'attention' ? 'active' : ''}
							onClick={() => selectFilter('attention')}
							type="button"
						>
							Attention
						</button>
						<button
							aria-pressed={filter === 'active'}
							className={filter === 'active' ? 'active' : ''}
							onClick={() => selectFilter('active')}
							type="button"
						>
							Queue
						</button>
						<button
							aria-pressed={filter === 'completed'}
							className={filter === 'completed' ? 'active' : ''}
							onClick={() => selectFilter('completed')}
							type="button"
						>
							Evidence
						</button>
						<button
							aria-pressed={filter === 'archive-errors'}
							className={filter === 'archive-errors' ? 'active' : ''}
							onClick={() => selectFilter('archive-errors')}
							type="button"
						>
							Archive errors
						</button>
						<button
							aria-pressed={filter === 'worker-issues'}
							className={filter === 'worker-issues' ? 'active' : ''}
							onClick={() => selectFilter('worker-issues')}
							type="button"
						>
							Worker issues
						</button>
						<button
							aria-pressed={filter === 'all'}
							className={filter === 'all' ? 'active' : ''}
							onClick={() => selectFilter('all')}
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
						{visibleLogs.map((entry, index) => {
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
							const concurrencyMetric = getConcurrencyMetric(entry);
							const primaryProgressMetric = getPrimaryProgressMetric(entry);
							const secondaryProgressMetric = getSecondaryProgressMetric(entry);
							const rangeMetric = getRangeMetric(entry);

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
											<dt>{primaryProgressMetric.label}</dt>
											<dd>{primaryProgressMetric.value}</dd>
										</div>
										<div>
											<dt>{secondaryProgressMetric.label}</dt>
											<dd>{secondaryProgressMetric.value}</dd>
										</div>
										<div>
											<dt>{rangeMetric.label}</dt>
											<dd>{rangeMetric.value}</dd>
										</div>
										<div>
											<dt>{concurrencyMetric.label}</dt>
											<dd>{concurrencyMetric.value}</dd>
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
				{filteredLogs.length > RANGE_PAGE_SIZE ? (
					<div className="table-pagination">
						<button
							disabled={safePage === 0}
							onClick={() => setPage(safePage - 1)}
							type="button"
						>
							Previous
						</button>
						<span>
							Page {formatInteger(safePage + 1)} of {formatInteger(pageCount)}
						</span>
						<button
							disabled={safePage >= pageCount - 1}
							onClick={() => setPage(safePage + 1)}
							type="button"
						>
							Next
						</button>
					</div>
				) : null}
			</div>
		</details>
	);
}

const scanLogIsCleanCompletedRun = (
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

const getRangeMetric = (
	entry: PublicHistoryArchiveScanLogEntry
): {
	readonly label: 'Current range' | 'Range';
	readonly value: string;
} => {
	if (scanLogIsActive(entry)) {
		const currentRange = formatOptionalRange(
			entry.currentRangeFromLedger,
			entry.currentRangeToLedger
		);
		if (currentRange !== null) {
			return { label: 'Current range', value: currentRange };
		}
	}

	return { label: 'Range', value: formatRange(entry) };
};

const getPrimaryProgressMetric = (
	entry: PublicHistoryArchiveScanLogEntry
): {
	readonly label: 'Contiguous' | 'Verified';
	readonly value: string;
} => {
	if (scanLogIsActive(entry)) {
		return {
			label: 'Contiguous',
			value: formatContiguousProgress(entry.latestScannedLedger)
		};
	}

	return {
		label: 'Verified',
		value: formatInteger(entry.latestVerifiedLedger)
	};
};

const getSecondaryProgressMetric = (
	entry: PublicHistoryArchiveScanLogEntry
): {
	readonly label: 'Attempted' | 'Scanned';
	readonly value: string;
} => {
	if (scanLogIsActive(entry)) {
		return {
			label: 'Attempted',
			value: formatAttemptedProgress(entry)
		};
	}

	return {
		label: 'Scanned',
		value: formatInteger(entry.latestScannedLedger)
	};
};

const formatContiguousProgress = (value: number): string => {
	if (value > 0) return formatInteger(value);
	return 'Not advanced yet';
};

const formatAttemptedProgress = (
	entry: PublicHistoryArchiveScanLogEntry
): string => {
	const ledger =
		entry.latestAttemptedLedger ??
		entry.currentRangeToLedger ??
		entry.latestScannedLedger;
	if (ledger > 0) return formatInteger(ledger);
	return entry.status === 'queued' ? 'Waiting for worker' : 'Starting';
};

const formatOptionalRange = (
	fromLedger: number | null | undefined,
	toLedger: number | null | undefined
): string | null => {
	if (typeof fromLedger === 'number' && Number.isFinite(fromLedger)) {
		const end =
			typeof toLedger === 'number' && Number.isFinite(toLedger)
				? formatInteger(toLedger)
				: 'latest';
		return `${formatInteger(fromLedger)} - ${end}`;
	}
	return null;
};

const formatConcurrency = (entry: PublicHistoryArchiveScanLogEntry): string => {
	if (entry.status === 'queued') return 'Waiting for worker';
	if (entry.status === 'stale' && entry.concurrency === null) {
		return 'Worker heartbeat stale';
	}
	if (
		entry.concurrency === null ||
		!Number.isFinite(entry.concurrency) ||
		entry.concurrency <= 0
	) {
		if (entry.status === 'completed') return 'Not reported';
		if (entry.status === 'stale') return 'Worker heartbeat stale';
		return 'Starting';
	}

	return `${formatInteger(entry.concurrency)} requests`;
};

const getConcurrencyMetric = (
	entry: PublicHistoryArchiveScanLogEntry
): {
	readonly label: 'Per-job requests' | 'Worker state';
	readonly value: string;
} => {
	if (typeof entry.concurrency === 'number' && entry.concurrency > 0) {
		return {
			label: 'Per-job requests',
			value: formatConcurrency(entry)
		};
	}

	return {
		label: 'Worker state',
		value: formatConcurrency(entry)
	};
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

const RANGE_PAGE_SIZE = 10;

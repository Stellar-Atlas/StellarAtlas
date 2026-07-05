'use client';

import { useMemo, useState } from 'react';
import type { PublicHistoryArchiveScanLogEntry } from '../../api/types';
import { formatDateTime, formatInteger } from '../../format/formatters';
import {
	getArchiveVerificationErrors,
	scanLogHasArchiveVerificationError,
	scanLogIsActive
} from '../../domain/history-archive';

interface HistoryArchiveScanLogProps {
	readonly logs: readonly PublicHistoryArchiveScanLogEntry[];
}

type ScanLogFilter =
	'attention' | 'active' | 'archive-errors' | 'successful' | 'all';

export function HistoryArchiveScanLog({
	logs
}: HistoryArchiveScanLogProps): React.JSX.Element {
	const [filter, setFilter] = useState<ScanLogFilter>('attention');
	const filteredLogs = useMemo(
		() =>
			logs.filter((entry) => {
				if (filter === 'attention') {
					return (
						scanLogIsActive(entry) || scanLogHasArchiveVerificationError(entry)
					);
				}
				if (filter === 'active') return scanLogIsActive(entry);
				if (filter === 'archive-errors') {
					return scanLogHasArchiveVerificationError(entry);
				}
				if (filter === 'successful') return scanLogIsSuccessfulRun(entry);

				return true;
			}),
		[filter, logs]
	);
	const archiveErrorCount = logs.filter(
		scanLogHasArchiveVerificationError
	).length;
	const successfulRunCount = logs.filter(scanLogIsSuccessfulRun).length;
	const activeCount = logs.filter(scanLogIsActive).length;

	if (logs.length === 0) {
		return (
			<p className="muted-copy">No archive scan jobs are available yet.</p>
		);
	}

	return (
		<div className="archive-scan-log">
			<div className="archive-scan-log-toolbar">
				<div>
					<strong>{formatInteger(logs.length)}</strong>
					<span> recent scan jobs</span>
					<span className="muted-inline">
						{' '}
						/ {formatInteger(activeCount)} active /{' '}
						{formatInteger(archiveErrorCount)} archive errors /{' '}
						{formatInteger(successfulRunCount)} successful runs
					</span>
				</div>
				<div className="segmented" aria-label="Archive scan log filter">
					<button
						className={filter === 'attention' ? 'active' : ''}
						onClick={() => setFilter('attention')}
						type="button"
					>
						Active + errors
					</button>
					<button
						className={filter === 'active' ? 'active' : ''}
						onClick={() => setFilter('active')}
						type="button"
					>
						Active
					</button>
					<button
						className={filter === 'archive-errors' ? 'active' : ''}
						onClick={() => setFilter('archive-errors')}
						type="button"
					>
						Archive errors
					</button>
					<button
						className={filter === 'successful' ? 'active' : ''}
						onClick={() => setFilter('successful')}
						type="button"
					>
						Successful runs
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
					{filteredLogs.map((entry) => {
						const isActive = scanLogIsActive(entry);
						const archiveErrors = getArchiveVerificationErrors(entry.errors);
						const hasArchiveErrors = archiveErrors.length > 0;
						let rowTone = 'is-success';
						let rowTitle = 'No archive errors';
						let rowTag = 'success';

						if (isActive) {
							rowTone = 'is-active';
							rowTitle = getActiveRowTitle(entry.status);
							rowTag = entry.status;
						} else if (hasArchiveErrors) {
							rowTone = 'has-error';
							rowTitle = 'Archive verification errors';
							rowTag = 'archive error';
						} else if (entry.status === 'stale') {
							rowTone = 'is-active';
							rowTitle = 'Scanner delayed';
							rowTag = 'delayed';
						}

						const rowErrors =
							filter === 'archive-errors' ? archiveErrors : archiveErrors;

						return (
							<li
								className={rowTone}
								key={`${entry.url}:${entry.startDate}:${entry.latestScannedLedger}`}
							>
								<div className="archive-scan-log-row">
									<div>
										<strong>{rowTitle}</strong>
										<span>{formatDateTime(entry.endDate)}</span>
									</div>
									<span className={getRowTagClassName(rowTone)}>{rowTag}</span>
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
								{rowErrors.length > 0 ? (
									<ul className="archive-error-list compact">
										{rowErrors.map((error, index) => (
											<li key={`${error.type}:${error.url}:${index}`}>
												<ErrorUrl url={error.url} />
												<span>
													{getErrorClassLabel(error.type)}: {error.message}
												</span>
											</li>
										))}
									</ul>
								) : (
									<p className="archive-scan-log-note">
										No archive errors detected for this scan run.
									</p>
								)}
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
	!scanLogHasArchiveVerificationError(entry);

const getEmptyFilterMessage = (filter: ScanLogFilter): string => {
	if (filter === 'attention') {
		return 'No active scan runs or archive verification errors are recorded for this archive.';
	}
	if (filter === 'active') {
		return 'No active scan runs are recorded for this archive right now.';
	}
	if (filter === 'archive-errors') {
		return 'No current archive verification errors match this filter.';
	}
	if (filter === 'successful') {
		return 'No successful completed scan runs are recorded for this archive yet.';
	}

	return 'No archive scan runs are available for this filter.';
};

const formatRange = (entry: PublicHistoryArchiveScanLogEntry): string => {
	if (
		entry.status === 'queued' &&
		entry.fromLedger === 0 &&
		entry.toLedger === null
	) {
		return 'pending';
	}

	return `${formatInteger(entry.fromLedger)} - ${
		entry.toLedger === null ? 'latest' : formatInteger(entry.toLedger)
	}`;
};

const formatConcurrency = (entry: PublicHistoryArchiveScanLogEntry): string => {
	if (entry.status === 'queued') return 'pending';
	if (entry.concurrency === null) return 'starting';

	return formatInteger(entry.concurrency);
};

const formatDuration = (entry: PublicHistoryArchiveScanLogEntry): string => {
	if (entry.status === 'queued') return 'pending';
	const durationMs = entry.durationMs;
	if (!Number.isFinite(durationMs) || durationMs < 0) return 'Unknown';
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

const getActiveRowTitle = (
	status: PublicHistoryArchiveScanLogEntry['status']
): string => {
	if (status === 'scanning') return 'Scanning now';
	if (status === 'starting') return 'Starting scan';
	if (status === 'stale') return 'Scanner delayed';
	return 'Pending scan';
};

const getErrorClassLabel = (_type: string): string => 'Archive';

const ErrorUrl = ({ url }: { readonly url: string }): React.JSX.Element => {
	if (url.startsWith('http://') || url.startsWith('https://')) {
		return (
			<a href={url} rel="noopener noreferrer" target="_blank">
				{url}
			</a>
		);
	}

	return <span>{url}</span>;
};

'use client';

import { useMemo, useState } from 'react';
import type { PublicHistoryArchiveScanLogEntry } from '../../api/types';
import {
	formatDateTime,
	formatInteger
} from '../../format/formatters';
import {
	getArchiveVerificationErrors,
	getWorkerIssues,
	scanLogHasArchiveVerificationError,
	scanLogHasWorkerIssue
} from '../../domain/history-archive';

interface HistoryArchiveScanLogProps {
	readonly logs: readonly PublicHistoryArchiveScanLogEntry[];
}

type ScanLogFilter = 'archive-errors' | 'worker-issues' | 'all';

export function HistoryArchiveScanLog({
	logs
}: HistoryArchiveScanLogProps): React.JSX.Element {
	const [filter, setFilter] = useState<ScanLogFilter>('archive-errors');
	const filteredLogs = useMemo(
		() =>
			logs.filter((entry) => {
				if (filter === 'archive-errors') {
					return scanLogHasArchiveVerificationError(entry);
				}
				if (filter === 'worker-issues') return scanLogHasWorkerIssue(entry);

				return true;
			}),
		[filter, logs]
	);
	const archiveErrorCount = logs.filter(scanLogHasArchiveVerificationError).length;
	const workerIssueCount = logs.filter(scanLogHasWorkerIssue).length;

	if (logs.length === 0) {
		return (
			<p className="muted-copy">
				No completed archive scan runs are available yet.
			</p>
		);
	}

	return (
		<div className="archive-scan-log">
			<div className="archive-scan-log-toolbar">
				<div>
					<strong>{formatInteger(logs.length)}</strong>
					<span> recent scan runs</span>
					<span className="muted-inline">
						{' '}
						/ {formatInteger(archiveErrorCount)} archive errors
						{' '}
						/ {formatInteger(workerIssueCount)} worker issues
					</span>
				</div>
				<div className="segmented" aria-label="Archive scan log filter">
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
				<p className="muted-copy">
					No archive scan runs match the current filter.
				</p>
			) : (
				<ul className="archive-scan-log-list">
					{filteredLogs.map((entry) => {
						const archiveErrors = getArchiveVerificationErrors(entry.errors);
						const workerIssues = getWorkerIssues(entry.errors);
						const hasArchiveErrors = archiveErrors.length > 0;
						const hasWorkerIssues = workerIssues.length > 0;
						const rowTone = hasArchiveErrors || hasWorkerIssues
							? 'has-error'
							: 'is-success';
						const rowTitle = hasArchiveErrors
							? 'Archive verification errors'
							: hasWorkerIssues
								? 'Worker issues'
								: 'No archive errors';
						const rowTag = hasArchiveErrors
							? 'archive error'
							: hasWorkerIssues
								? 'worker issue'
								: 'success';
						const rowErrors = hasArchiveErrors
							? archiveErrors
							: workerIssues;

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
								<span className={rowTone === 'has-error' ? 'tag warning' : 'tag good'}>
									{rowTag}
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
									<dd>
										{formatInteger(entry.fromLedger)} -{' '}
										{entry.toLedger === null
											? 'latest'
											: formatInteger(entry.toLedger)}
									</dd>
								</div>
								<div>
									<dt>Concurrency</dt>
									<dd>{formatInteger(entry.concurrency)}</dd>
								</div>
								<div>
									<dt>Duration</dt>
									<dd>{formatDuration(entry.durationMs)}</dd>
								</div>
							</dl>
							{rowErrors.length > 0 ? (
								<ul className="archive-error-list compact">
									{rowErrors.map((error, index) => (
										<li key={`${error.type}:${error.url}:${index}`}>
											<a
												href={error.url}
												rel="noopener noreferrer"
												target="_blank"
											>
												{error.url}
											</a>
											<span>{error.message}</span>
										</li>
									))}
								</ul>
							) : null}
						</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

const formatDuration = (durationMs: number): string => {
	if (!Number.isFinite(durationMs) || durationMs < 0) return 'Unknown';
	if (durationMs < 1000) return `${Math.round(durationMs)} ms`;

	const durationSeconds = Math.round(durationMs / 1000);
	if (durationSeconds < 60) return `${durationSeconds}s`;

	const minutes = Math.floor(durationSeconds / 60);
	const seconds = durationSeconds % 60;
	return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
};

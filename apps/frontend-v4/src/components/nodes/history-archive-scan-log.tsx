'use client';

import { useMemo, useState } from 'react';
import type { PublicHistoryArchiveScanLogEntry } from '../../api/types';
import {
	formatDateTime,
	formatInteger
} from '../../format/formatters';

interface HistoryArchiveScanLogProps {
	readonly logs: readonly PublicHistoryArchiveScanLogEntry[];
}

type ScanLogFilter = 'all' | 'errors';

export function HistoryArchiveScanLog({
	logs
}: HistoryArchiveScanLogProps): React.JSX.Element {
	const [filter, setFilter] = useState<ScanLogFilter>('all');
	const filteredLogs = useMemo(
		() => logs.filter((entry) => filter === 'all' || entry.hasError),
		[filter, logs]
	);
	const errorCount = logs.filter((entry) => entry.hasError).length;

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
						/ {formatInteger(errorCount)} with errors
					</span>
				</div>
				<div className="segmented" aria-label="Archive scan log filter">
					<button
						className={filter === 'all' ? 'active' : ''}
						onClick={() => setFilter('all')}
						type="button"
					>
						All
					</button>
					<button
						className={filter === 'errors' ? 'active' : ''}
						onClick={() => setFilter('errors')}
						type="button"
					>
						Errors
					</button>
				</div>
			</div>
			{filteredLogs.length === 0 ? (
				<p className="muted-copy">
					No archive scan runs match the current filter.
				</p>
			) : (
				<ul className="archive-scan-log-list">
					{filteredLogs.map((entry) => (
						<li
							className={entry.hasError ? 'has-error' : 'is-success'}
							key={`${entry.url}:${entry.startDate}:${entry.latestScannedLedger}`}
						>
							<div className="archive-scan-log-row">
								<div>
									<strong>
										{entry.hasError ? 'Verification errors' : 'No errors'}
									</strong>
									<span>{formatDateTime(entry.endDate)}</span>
								</div>
								<span className={entry.hasError ? 'tag warning' : 'tag good'}>
									{entry.hasError ? 'error' : 'success'}
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
							{entry.errors.length > 0 ? (
								<ul className="archive-error-list compact">
									{entry.errors.map((error, index) => (
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
					))}
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

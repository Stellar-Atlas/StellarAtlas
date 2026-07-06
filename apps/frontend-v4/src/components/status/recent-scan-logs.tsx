'use client';

import { useMemo, useState } from 'react';
import type {
	PublicNetworkScanLogEntry,
	PublicScanLogStatus,
	PublicStatusLevel
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusPill, StatusRow } from './status-ui';

type ScanLogFilter = 'attention' | 'network' | 'all';

const segmentedControlStyle = {
	flexWrap: 'wrap',
	maxWidth: '100%',
	overflow: 'visible'
} as const;

export function RecentScanLogs({
	scanLogs
}: {
	readonly scanLogs: PublicScanLogStatus;
}): React.JSX.Element {
	const [filter, setFilter] = useState<ScanLogFilter>('attention');
	const networkScans = useMemo(
		() => filterNetworkScans(scanLogs.networkScans, filter),
		[filter, scanLogs.networkScans]
	);

	return (
		<section className="panel status-scan-log-panel">
			<div className="panel-heading">
				<div>
					<strong>Recent Network Scan Logs</strong>
					<span>{formatDateTime(scanLogs.generatedAt)}</span>
				</div>
				<span className="status-muted">
					{formatInteger(scanLogs.limit)} row API limit
				</span>
			</div>
			<div className="archive-scan-log">
				<div
					className="segmented"
					aria-label="Recent scan log filter"
					style={segmentedControlStyle}
				>
					{scanLogFilters.map((candidate) => (
						<button
							aria-pressed={filter === candidate.value}
							className={filter === candidate.value ? 'active' : ''}
							key={candidate.value}
							onClick={() => setFilter(candidate.value)}
							type="button"
						>
							{candidate.label}
						</button>
					))}
				</div>
			</div>
			<div className="status-scan-log-grid">
				<RecentNetworkScans filter={filter} scans={networkScans} />
			</div>
		</section>
	);
}

const scanLogFilters: readonly {
	readonly label: string;
	readonly value: ScanLogFilter;
}[] = [
	{ label: 'Attention', value: 'attention' },
	{ label: 'Network', value: 'network' },
	{ label: 'All', value: 'all' }
];

function RecentNetworkScans({
	filter,
	scans
}: {
	readonly filter: ScanLogFilter;
	readonly scans: readonly PublicNetworkScanLogEntry[];
}): React.JSX.Element {
	const emptyState = getEmptyNetworkState(filter);

	return (
		<div className="status-scan-log-column">
			<h3>Network scans</h3>
			<div className="status-list">
				{scans.map((scan) => (
					<NetworkScanDetails key={scan.time} scan={scan} />
				))}
				{scans.length === 0 && <EmptyLogRow state={emptyState} />}
			</div>
		</div>
	);
}

function NetworkScanDetails({
	scan
}: {
	readonly scan: PublicNetworkScanLogEntry;
}): React.JSX.Element {
	const status: PublicStatusLevel = scan.completed ? 'ok' : 'degraded';

	return (
		<details className="metadata-document" open={!scan.completed}>
			<summary>
				<span>{formatDateTime(scan.time)}</span>
				<span>
					<StatusPill
						status={status}
						text={scan.completed ? 'Complete' : 'Incomplete'}
					/>
				</span>
			</summary>
			<dl className="details">
				<div>
					<dt>Latest ledger</dt>
					<dd>{scan.latestLedger}</dd>
				</div>
				<div>
					<dt>Processed ledgers</dt>
					<dd>{formatInteger(scan.ledgersCount)}</dd>
				</div>
				<div>
					<dt>Latest close</dt>
					<dd>{formatNullableDate(scan.latestLedgerCloseTime)}</dd>
				</div>
				{scan.archiveScheduling ? (
					<>
						<div>
							<dt>Archive URLs</dt>
							<dd>
								{formatInteger(
									scan.archiveScheduling.discoveredArchiveUrlCount
								)}{' '}
								discovered
							</dd>
						</div>
						<div>
							<dt>Archive jobs</dt>
							<dd>{formatArchiveScheduling(scan.archiveScheduling)}</dd>
						</div>
					</>
				) : null}
				<div>
					<dt>Status</dt>
					<dd>{scan.status}</dd>
				</div>
			</dl>
		</details>
	);
}

function formatArchiveScheduling(
	archiveScheduling: NonNullable<PublicNetworkScanLogEntry['archiveScheduling']>
): string {
	const scheduled = formatInteger(
		archiveScheduling.scheduledArchiveScanJobCount
	);
	const suppressed = formatInteger(
		archiveScheduling.duplicateSuppressedArchiveScanJobCount
	);
	const errors = formatInteger(archiveScheduling.schedulerErrorCount);

	return `${scheduled} scheduled, ${suppressed} already queued, ${errors} errors`;
}

interface EmptyLogState {
	readonly detail: string;
	readonly label: string;
	readonly status: PublicStatusLevel;
	readonly value: string;
}

function EmptyLogRow({
	state
}: {
	readonly state: EmptyLogState;
}): React.JSX.Element {
	return (
		<StatusRow
			detail={state.detail}
			label={state.label}
			status={state.status}
			value={state.value}
		/>
	);
}

function getEmptyNetworkState(filter: ScanLogFilter): EmptyLogState {
	if (filter === 'attention') {
		return {
			detail: 'No incomplete network scan rows match this filter',
			label: 'No network scan issues',
			status: 'ok',
			value: 'Clear'
		};
	}

	return {
		detail: 'No recent network scan rows match this filter',
		label: 'No network scans',
		status: 'unavailable',
		value: 'No data'
	};
}

function filterNetworkScans(
	scans: readonly PublicNetworkScanLogEntry[],
	filter: ScanLogFilter
): readonly PublicNetworkScanLogEntry[] {
	if (filter === 'attention') return scans.filter((scan) => !scan.completed);
	return scans;
}

function formatNullableDate(value: string | null): string {
	return value === null ? 'No data' : formatDateTime(value);
}

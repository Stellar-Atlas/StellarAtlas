'use client';

import { useMemo, useState } from 'react';
import type {
	PublicNetworkScanLogEntry,
	PublicScanLogStatus,
	PublicStatusLevel
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusPill } from './status-ui';

type ScanLogFilter = 'attention' | 'all';

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
					<strong>Network scans</strong>
					<span>{formatDateTime(scanLogs.generatedAt)}</span>
				</div>
				<span className="status-muted">
					Showing up to {formatInteger(scanLogs.limit)} recent rows
				</span>
			</div>
			<div className="archive-scan-log">
				<div className="segmented" aria-label="Recent scan log filter">
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
			<NetworkScanTable filter={filter} scans={networkScans} />
		</section>
	);
}

function NetworkScanTable({
	filter,
	scans
}: {
	readonly filter: ScanLogFilter;
	readonly scans: readonly PublicNetworkScanLogEntry[];
}): React.JSX.Element {
	if (scans.length === 0) return <EmptyNetworkScanTable filter={filter} />;

	return (
		<div className="responsive-table status-network-scan-table-wrap">
			<table className="status-network-scan-table">
				<NetworkScanTableHead />
				<tbody>
					{scans.map((scan) => (
						<NetworkScanRow key={scan.time} scan={scan} />
					))}
				</tbody>
			</table>
		</div>
	);
}

function NetworkScanRow({
	scan
}: {
	readonly scan: PublicNetworkScanLogEntry;
}): React.JSX.Element {
	const scheduling = scan.archiveScheduling;
	const status: PublicStatusLevel = scan.completed ? 'ok' : 'degraded';

	return (
		<tr>
			<td>
				<strong>{formatDateTime(scan.time)}</strong>
				<small>{formatLatestClose(scan.latestLedgerCloseTime)}</small>
			</td>
			<td>
				<StatusPill
					status={status}
					text={scan.completed ? 'complete' : 'incomplete'}
				/>
			</td>
			<td>{scan.latestLedger}</td>
			<td>{formatInteger(scan.ledgersCount)}</td>
			<td>{formatInteger(scheduling.discoveredArchiveUrlCount)}</td>
			<td>{formatInteger(scheduling.scheduledArchiveScanJobCount)}</td>
			<td>{formatInteger(scheduling.duplicateSuppressedArchiveScanJobCount)}</td>
			<td>{formatInteger(scheduling.schedulerErrorCount)}</td>
		</tr>
	);
}

function EmptyNetworkScanTable({
	filter
}: {
	readonly filter: ScanLogFilter;
}): React.JSX.Element {
	return (
		<div className="responsive-table status-network-scan-table-wrap">
			<table className="status-network-scan-table">
				<NetworkScanTableHead />
				<tbody>
					<tr>
						<td colSpan={NETWORK_SCAN_COLUMN_COUNT}>
							<strong>{getEmptyNetworkLabel(filter)}</strong>
							<small>{getEmptyNetworkDetail(filter)}</small>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}

function NetworkScanTableHead(): React.JSX.Element {
	return (
		<thead>
			<tr>
				<th>Scan time</th>
				<th>Status</th>
				<th>Latest ledger</th>
				<th>Processed ledgers</th>
				<th>Archive roots observed</th>
				<th>New checks queued</th>
				<th>Already tracked checks</th>
				<th>Scheduler errors</th>
			</tr>
		</thead>
	);
}

function filterNetworkScans(
	scans: readonly PublicNetworkScanLogEntry[],
	filter: ScanLogFilter
): readonly PublicNetworkScanLogEntry[] {
	if (filter === 'attention') return scans.filter((scan) => !scan.completed);
	return scans;
}

function formatLatestClose(value: string | null): string {
	return value === null ? 'latest close not recorded' : formatDateTime(value);
}

function getEmptyNetworkLabel(filter: ScanLogFilter): string {
	return filter === 'attention' ? 'No network scan issues' : 'No network scans';
}

function getEmptyNetworkDetail(filter: ScanLogFilter): string {
	return filter === 'attention'
		? 'No incomplete network scan rows match this filter.'
		: 'No recent network scan rows match this filter.';
}

const scanLogFilters: readonly {
	readonly label: string;
	readonly value: ScanLogFilter;
}[] = [
	{ label: 'Attention', value: 'attention' },
	{ label: 'All scans', value: 'all' }
];

const NETWORK_SCAN_COLUMN_COUNT = 8;

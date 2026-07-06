'use client';

import { useMemo, useState } from 'react';
import type {
	PublicArchiveScanLogEntry,
	PublicHistoryArchiveScanLogError,
	PublicNetworkScanLogEntry,
	PublicScanLogStatus,
	PublicStatusLevel
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusPill, StatusRow } from './status-ui';

type ScanLogFilter =
	| 'attention'
	| 'network'
	| 'archive'
	| 'archive-errors'
	| 'worker-issues'
	| 'all';

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
	const archiveScans = useMemo(
		() => filterArchiveScans(scanLogs.archiveScans, filter),
		[filter, scanLogs.archiveScans]
	);
	const showNetwork = shouldShowNetworkColumn(filter);
	const showArchive = shouldShowArchiveColumn(filter);

	return (
		<section className="panel status-scan-log-panel">
			<div className="panel-heading">
				<div>
					<strong>Recent Scan Logs</strong>
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
				{showNetwork ? (
					<RecentNetworkScans filter={filter} scans={networkScans} />
				) : null}
				{showArchive ? (
					<RecentArchiveScans filter={filter} scans={archiveScans} />
				) : null}
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
	{ label: 'Archive', value: 'archive' },
	{ label: 'Archive errors', value: 'archive-errors' },
	{ label: 'Worker issues', value: 'worker-issues' },
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

function RecentArchiveScans({
	filter,
	scans
}: {
	readonly filter: ScanLogFilter;
	readonly scans: readonly PublicArchiveScanLogEntry[];
}): React.JSX.Element {
	const emptyState = getEmptyArchiveState(filter);

	return (
		<div className="status-scan-log-column">
			<h3>Archive scan runs</h3>
			<div className="status-list">
				{scans.map((scan, index) => (
					<ArchiveScanDetails
						key={`${scan.url}-${scan.startDate}-${scan.latestScannedLedger}-${index}`}
						scan={scan}
					/>
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
				<div>
					<dt>Status</dt>
					<dd>{scan.status}</dd>
				</div>
			</dl>
		</details>
	);
}

function ArchiveScanDetails({
	scan
}: {
	readonly scan: PublicArchiveScanLogEntry;
}): React.JSX.Element {
	return (
		<details className="metadata-document" open={scan.scanStatus !== 'ok'}>
			<summary>
				<span>{formatArchiveUrl(scan.url)}</span>
				<span>
					<StatusPill
						status={archiveScanTone(scan)}
						text={archiveScanLabel(scan)}
					/>
				</span>
			</summary>
			<dl className="details">
				<div>
					<dt>Range</dt>
					<dd>{formatLedgerRange(scan.fromLedger, scan.toLedger)}</dd>
				</div>
				<div>
					<dt>Verified</dt>
					<dd>{formatInteger(scan.latestVerifiedLedger)}</dd>
				</div>
				<div>
					<dt>Scanned</dt>
					<dd>{formatInteger(scan.latestScannedLedger)}</dd>
				</div>
				<div>
					<dt>Concurrency</dt>
					<dd>{formatInteger(scan.concurrency)} workers</dd>
				</div>
				<div>
					<dt>Duration</dt>
					<dd>{formatDuration(scan.durationMs)}</dd>
				</div>
				<div>
					<dt>Ended</dt>
					<dd>{formatDateTime(scan.endDate)}</dd>
				</div>
			</dl>
			{scan.errors.length > 0 ? (
				<ErrorList errors={scan.errors} />
			) : (
				<p className="muted-copy">{archiveScanEmptyDetail(scan)}</p>
			)}
		</details>
	);
}

function ErrorList({
	errors
}: {
	readonly errors: readonly PublicHistoryArchiveScanLogError[];
}): React.JSX.Element {
	return (
		<ul className="archive-error-list compact">
			{errors.map((error, index) => (
				<li key={`${error.type}:${error.url}:${index}`}>
					<ErrorTarget url={error.url} />
					<span>
						{error.type === 'TYPE_VERIFICATION'
							? 'Archive evidence'
							: 'Worker infrastructure'}
						: {sanitizeEvidenceText(error.message)}
					</span>
				</li>
			))}
		</ul>
	);
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

function getEmptyArchiveState(filter: ScanLogFilter): EmptyLogState {
	if (filter === 'worker-issues') {
		return {
			detail: 'No worker infrastructure issue rows match this filter',
			label: 'No worker issues',
			status: 'ok',
			value: 'Clear'
		};
	}
	if (filter === 'archive-errors' || filter === 'attention') {
		return {
			detail: 'No archive verification error rows match this filter',
			label: 'No archive errors',
			status: 'ok',
			value: 'Clear'
		};
	}

	return {
		detail: 'No recent archive scan rows match this filter',
		label: 'No archive scans',
		status: 'unavailable',
		value: 'No data'
	};
}

function filterNetworkScans(
	scans: readonly PublicNetworkScanLogEntry[],
	filter: ScanLogFilter
): readonly PublicNetworkScanLogEntry[] {
	if (filter === 'archive' || filter === 'archive-errors') return [];
	if (filter === 'worker-issues') return [];
	if (filter === 'attention') return scans.filter((scan) => !scan.completed);
	return scans;
}

function filterArchiveScans(
	scans: readonly PublicArchiveScanLogEntry[],
	filter: ScanLogFilter
): readonly PublicArchiveScanLogEntry[] {
	if (filter === 'network') return [];
	if (filter === 'archive-errors') {
		return scans.filter((scan) => scan.hasArchiveVerificationError);
	}
	if (filter === 'worker-issues') {
		return scans.filter((scan) => scan.hasWorkerIssue);
	}
	if (filter === 'attention') {
		return scans.filter((scan) => scan.scanStatus !== 'ok');
	}
	return scans;
}

function shouldShowNetworkColumn(filter: ScanLogFilter): boolean {
	return filter === 'all' || filter === 'attention' || filter === 'network';
}

function shouldShowArchiveColumn(filter: ScanLogFilter): boolean {
	return filter !== 'network';
}

function archiveScanTone(scan: PublicArchiveScanLogEntry): PublicStatusLevel {
	if (scan.scanStatus === 'ok') return 'ok';
	return 'degraded';
}

function archiveScanLabel(scan: PublicArchiveScanLogEntry): string {
	if (scan.scanStatus === 'ok') return 'No archive errors';
	if (scan.scanStatus === 'worker_issue') return 'Worker issue';
	return 'Archive error';
}

function archiveScanEmptyDetail(scan: PublicArchiveScanLogEntry): string {
	if (scan.scanStatus === 'ok') {
		return 'Compact status payload reports no archive verification errors.';
	}
	return 'No individual error rows were included in this compact status payload.';
}

function formatLedgerRange(
	fromLedger: number,
	toLedger: number | null
): string {
	const end = toLedger === null ? 'latest' : formatInteger(toLedger);
	return `${formatInteger(fromLedger)}-${end}`;
}

function formatArchiveUrl(value: string): string {
	if (looksLikeInternalPath(value)) return 'Internal scanner target';
	try {
		const url = new URL(value);
		if (url.protocol === 'http:' || url.protocol === 'https:') {
			return url.hostname;
		}
		return 'Internal scanner target';
	} catch {
		return sanitizeEvidenceText(value);
	}
}

function formatNullableDate(value: string | null): string {
	return value === null ? 'No data' : formatDateTime(value);
}

function formatDuration(value: number): string {
	if (!Number.isFinite(value) || value < 0) return 'Unknown';
	const minutes = Math.round(value / 60000);
	if (minutes < 1) return '<1 min';
	if (minutes < 60) return `${formatInteger(minutes)} min`;
	return `${formatInteger(Math.round(minutes / 60))} hr`;
}

function sanitizeEvidenceText(value: string): string {
	return value.replace(
		/(?:file:\/\/)?\/(?:home|var|tmp|etc|opt|srv|mnt|root|usr)\/[^\s'"`<>)]*/g,
		'[internal path]'
	);
}

function looksLikeInternalPath(value: string): boolean {
	return (
		/^(?:file:\/\/)?\/(?:home|var|tmp|etc|opt|srv|mnt|root|usr)\//.test(
			value
		) || /^[A-Za-z]:\\/.test(value)
	);
}

function ErrorTarget({ url }: { readonly url: string }): React.JSX.Element {
	if (looksLikeInternalPath(url)) return <span>Internal scanner target</span>;
	try {
		const parsedUrl = new URL(url);
		if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
			return (
				<a href={url} rel="noopener noreferrer" target="_blank">
					{url}
				</a>
			);
		}
		return <span>Internal scanner target</span>;
	} catch {
		return <span>{sanitizeEvidenceText(url)}</span>;
	}
}

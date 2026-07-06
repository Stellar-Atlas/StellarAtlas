import type {
	PublicHistoryArchiveScanLogEntry,
	PublicHistoryArchiveScanLogError
} from '../../api/types';
import { formatDateTime } from '../../format/formatters';
import { scanLogIsActive } from '../../domain/history-archive';

export function ScanLogDetails({
	archiveErrors,
	entry,
	isActive,
	workerIssues
}: {
	readonly archiveErrors: readonly PublicHistoryArchiveScanLogError[];
	readonly entry: PublicHistoryArchiveScanLogEntry;
	readonly isActive: boolean;
	readonly workerIssues: readonly PublicHistoryArchiveScanLogError[];
}): React.JSX.Element {
	const hasPersistedIssues =
		archiveErrors.length > 0 || workerIssues.length > 0;

	return (
		<details
			className="metadata-document"
			open={isActive || hasPersistedIssues}
		>
			<summary>
				<span>
					{isActive ? 'Active job details' : 'Completed evidence details'}
				</span>
				<span>{formatDateTime(entry.updatedAt)}</span>
			</summary>
			<dl className="details">
				<div>
					<dt>Archive</dt>
					<dd>
						<ArchiveTarget url={entry.url} />
					</dd>
				</div>
				<div>
					<dt>Status</dt>
					<dd>{formatScanStatus(entry.status)}</dd>
				</div>
				<div>
					<dt>Started</dt>
					<dd>{formatDateTime(entry.startDate)}</dd>
				</div>
				<div>
					<dt>Updated</dt>
					<dd>{formatDateTime(entry.updatedAt)}</dd>
				</div>
			</dl>
			{archiveErrors.length > 0 ? (
				<ErrorList errors={archiveErrors} label="Archive evidence" />
			) : null}
			{workerIssues.length > 0 ? (
				<ErrorList errors={workerIssues} label="Worker infrastructure" />
			) : null}
			{!hasPersistedIssues ? (
				<p className="archive-scan-log-note">
					{isActive
						? 'No completed scan evidence has been reported for this active job yet.'
						: 'No archive verification errors or worker issues were recorded for this completed run.'}
				</p>
			) : null}
		</details>
	);
}

export function getRowPresentation(
	entry: PublicHistoryArchiveScanLogEntry,
	hasArchiveErrors: boolean,
	hasWorkerIssues: boolean
): {
	readonly tag: string;
	readonly title: string;
	readonly tone: string;
} {
	if (scanLogIsActive(entry)) {
		return {
			tag: entry.status === 'queued' ? 'queued' : entry.status,
			title: getActiveRowTitle(entry.status),
			tone: 'is-active'
		};
	}
	if (hasArchiveErrors) {
		return {
			tag: 'archive error',
			title: 'Completed archive error evidence',
			tone: 'has-error'
		};
	}
	if (hasWorkerIssues) {
		return {
			tag: 'worker issue',
			title: 'Completed worker issue evidence',
			tone: 'has-error'
		};
	}
	return {
		tag: 'completed',
		title: 'Completed scan evidence',
		tone: 'is-success'
	};
}

export function formatRowTimestamp(
	entry: PublicHistoryArchiveScanLogEntry
): string {
	const label = scanLogIsActive(entry) ? 'Updated' : 'Completed';
	const value = scanLogIsActive(entry) ? entry.updatedAt : entry.endDate;
	return `${label} ${formatDateTime(value)}`;
}

export function dedupeScanLogs(
	logs: readonly PublicHistoryArchiveScanLogEntry[]
): PublicHistoryArchiveScanLogEntry[] {
	const byKey = new Map<string, PublicHistoryArchiveScanLogEntry>();
	for (const entry of logs) {
		const key = getScanLogDedupeKey(entry);
		const existing = byKey.get(key);
		byKey.set(key, existing ? pickPreferredScanLog(existing, entry) : entry);
	}
	return [...byKey.values()];
}

export function getScanLogRenderKey(
	entry: PublicHistoryArchiveScanLogEntry,
	index: number
): string {
	return `${getScanLogDedupeKey(entry)}:${entry.startDate}:${index}`;
}

function ErrorList({
	errors,
	label
}: {
	readonly errors: readonly PublicHistoryArchiveScanLogError[];
	readonly label: string;
}): React.JSX.Element {
	return (
		<ul className="archive-error-list compact">
			{errors.map((error, index) => (
				<li key={`${error.type}:${error.url}:${index}`}>
					<ErrorUrl url={error.url} />
					<span>
						{label}: {sanitizeEvidenceText(error.message)}
					</span>
				</li>
			))}
		</ul>
	);
}

const getActiveRowTitle = (
	status: PublicHistoryArchiveScanLogEntry['status']
): string => {
	if (status === 'scanning') return 'Scanning now';
	if (status === 'starting') return 'Starting scan';
	if (status === 'stale') return 'Scanner delayed';
	return 'Waiting for worker';
};

function formatScanStatus(
	status: PublicHistoryArchiveScanLogEntry['status']
): string {
	if (status === 'completed') return 'Completed';
	return getActiveRowTitle(status);
}

function getScanLogDedupeKey(entry: PublicHistoryArchiveScanLogEntry): string {
	const range = `${entry.fromLedger}:${entry.toLedger ?? 'latest'}`;
	const url = normalizeArchiveUrl(entry.url);
	if (scanLogIsActive(entry)) return `${url}:${range}:active`;
	return `${url}:${range}:${entry.status}:${entry.updatedAt}`;
}

function pickPreferredScanLog(
	left: PublicHistoryArchiveScanLogEntry,
	right: PublicHistoryArchiveScanLogEntry
): PublicHistoryArchiveScanLogEntry {
	const leftActiveRank = getActiveStatusRank(left.status);
	const rightActiveRank = getActiveStatusRank(right.status);
	if (rightActiveRank > leftActiveRank) return right;
	if (leftActiveRank > rightActiveRank) return left;

	const leftUpdatedAt = Date.parse(left.updatedAt);
	const rightUpdatedAt = Date.parse(right.updatedAt);
	if (rightUpdatedAt > leftUpdatedAt) return right;
	if (leftUpdatedAt > rightUpdatedAt) return left;
	if (right.errors.length > left.errors.length) return right;
	if (left.errors.length > right.errors.length) return left;
	return right.latestScannedLedger > left.latestScannedLedger ? right : left;
}

function getActiveStatusRank(
	status: PublicHistoryArchiveScanLogEntry['status']
): number {
	if (status === 'scanning') return 4;
	if (status === 'stale') return 3;
	if (status === 'starting') return 2;
	if (status === 'queued') return 1;
	return 0;
}

function normalizeArchiveUrl(value: string): string {
	try {
		const url = new URL(value);
		url.hash = '';
		url.search = '';
		url.pathname = url.pathname.replace(/\/+$/, '');
		return url.toString().toLowerCase();
	} catch {
		return value.trim().toLowerCase();
	}
}

function ArchiveTarget({ url }: { readonly url: string }): React.JSX.Element {
	if (isPublicHttpUrl(url)) {
		return (
			<a href={url} rel="noopener noreferrer" target="_blank">
				{url}
			</a>
		);
	}
	if (looksLikeInternalPath(url)) return <span>Internal scanner target</span>;
	return <span>{sanitizeEvidenceText(url)}</span>;
}

const ErrorUrl = ({ url }: { readonly url: string }): React.JSX.Element => {
	if (isPublicHttpUrl(url)) {
		return (
			<a href={url} rel="noopener noreferrer" target="_blank">
				{url}
			</a>
		);
	}
	if (looksLikeInternalPath(url)) return <span>Internal scanner target</span>;

	return <span>{sanitizeEvidenceText(url)}</span>;
};

function isPublicHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
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

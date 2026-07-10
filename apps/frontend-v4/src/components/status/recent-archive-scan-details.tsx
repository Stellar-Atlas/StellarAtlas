import Link from 'next/link';
import type {
	PublicArchiveScanLogEntry,
	PublicHistoryArchiveScanLogError
} from '@api/types';
import { getArchiveScanDetailPath } from '@domain/archive-scan-routes';
import type { ArchiveHealthState } from '@domain/history-archive-health';
import { formatDateTime, formatInteger } from '@format/formatters';
import { ArchiveHealthPill } from './status-ui';

export function ArchiveScanDetails({
	scan
}: {
	readonly scan: PublicArchiveScanLogEntry;
}): React.JSX.Element {
	const concurrencyMetric = getArchiveConcurrencyMetric(scan);

	return (
		<details className="metadata-document" open={scan.scanStatus !== 'ok'}>
			<summary>
				<span>{formatArchiveUrl(scan.url)}</span>
				<span>
					<ArchiveHealthPill
						state={archiveScanState(scan)}
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
					<dt>Archive detail</dt>
					<dd>
						<Link href={getArchiveScanDetailPath(scan.url)}>
							Open scan detail
						</Link>
					</dd>
				</div>
				<div>
					<dt>Verified through</dt>
					<dd>{formatVerifiedProgress(scan.latestVerifiedLedger)}</dd>
				</div>
				<div>
					<dt>Verified contiguous</dt>
					<dd>{formatVerifiedProgress(scan.latestScannedLedger)}</dd>
				</div>
				<div>
					<dt>Attempted through</dt>
					<dd>{formatOptionalLedger(scan.latestAttemptedLedger)}</dd>
				</div>
				<div>
					<dt>{concurrencyMetric.label}</dt>
					<dd>{concurrencyMetric.value}</dd>
				</div>
				<div>
					<dt>Duration</dt>
					<dd>{formatDuration(scan.durationMs)}</dd>
				</div>
				<div>
					<dt>Started</dt>
					<dd>{formatDateTime(scan.startDate)}</dd>
				</div>
				<div>
					<dt>Ended</dt>
					<dd>{formatDateTime(scan.endDate)}</dd>
				</div>
				<div>
					<dt>Errors</dt>
					<dd>{formatErrorCount(scan)}</dd>
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

function archiveScanState(scan: PublicArchiveScanLogEntry): ArchiveHealthState {
	if (scan.scanStatus === 'archive_error') return 'remote_failure';
	if (scan.scanStatus === 'worker_issue') return 'scanner_issue';
	return 'unknown';
}

function archiveScanLabel(scan: PublicArchiveScanLogEntry): string {
	if (scan.scanStatus === 'ok') return 'No row failures';
	if (scan.scanStatus === 'worker_issue') return 'Scanner issue';
	return 'Remote failure';
}

function archiveScanEmptyDetail(scan: PublicArchiveScanLogEntry): string {
	if (scan.scanStatus === 'ok') {
		return 'No failures were reported for this historical range row.';
	}
	if (scan.scanStatus === 'worker_issue') {
		return 'No individual worker issue rows were included for this row.';
	}
	return 'No individual archive error rows were included for this row.';
}

function getArchiveConcurrencyMetric(scan: PublicArchiveScanLogEntry): {
	readonly label: 'Per-job requests' | 'Worker state';
	readonly value: string;
} {
	if (
		typeof scan.concurrency === 'number' &&
		Number.isFinite(scan.concurrency) &&
		scan.concurrency > 0
	) {
		return {
			label: 'Per-job requests',
			value: formatInteger(scan.concurrency)
		};
	}

	if (scan.concurrency === 'pending') {
		return { label: 'Worker state', value: 'Pending worker report' };
	}

	return { label: 'Worker state', value: 'Not reported' };
}

function formatErrorCount(scan: PublicArchiveScanLogEntry): string {
	if (scan.errorCount === scan.errors.length) {
		return formatInteger(scan.errorCount);
	}
	return `${formatInteger(scan.errorCount)} reported, ${formatInteger(
		scan.errors.length
	)} shown`;
}

function formatLedgerRange(
	fromLedger: number,
	toLedger: number | null
): string {
	const end = toLedger === null ? 'latest' : formatInteger(toLedger);
	return `${formatInteger(fromLedger)}-${end}`;
}

function formatVerifiedProgress(value: number): string {
	if (value > 0) return formatInteger(value);
	return 'No contiguous progress yet';
}

function formatOptionalLedger(value: number | null | undefined): string {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return formatInteger(value);
	}
	return 'Not reported yet';
}

function formatArchiveUrl(value: string): string {
	if (looksLikeInternalPath(value)) return 'Internal scanner target';
	try {
		const url = new URL(value);
		if (url.protocol === 'http:' || url.protocol === 'https:') {
			const path = url.pathname.replace(/\/+$/, '');
			return path.length > 0 ? `${url.hostname}${path}` : url.hostname;
		}
		return 'Internal scanner target';
	} catch {
		return sanitizeEvidenceText(value);
	}
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

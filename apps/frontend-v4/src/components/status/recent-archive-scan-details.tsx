import type {
	PublicArchiveScanLogEntry,
	PublicHistoryArchiveScanLogError,
	PublicStatusLevel
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusPill } from './status-ui';

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
	if (scan.scanStatus === 'worker_issue') {
		return 'No individual worker issue rows were included in this compact status payload.';
	}
	return 'No individual error rows were included in this compact status payload.';
}

function getArchiveConcurrencyMetric(scan: PublicArchiveScanLogEntry): {
	readonly label: 'Concurrency' | 'Worker state';
	readonly value: string;
} {
	if (
		typeof scan.concurrency === 'number' &&
		Number.isFinite(scan.concurrency) &&
		scan.concurrency > 0
	) {
		return {
			label: 'Concurrency',
			value: `${formatInteger(scan.concurrency)} workers`
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

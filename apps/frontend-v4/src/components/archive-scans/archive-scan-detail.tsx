import type {
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanEvidence,
	PublicHistoryArchiveScanLogEntry,
	PublicHistoryArchiveScanLogError
} from '@api/types';
import { HistoryArchiveScanLog } from '@components/nodes/history-archive-scan-log';
import { StatusPill } from '@components/status/status-ui';
import {
	getArchiveVerificationErrors,
	getWorkerIssues,
	scanLogIsActive
} from '@domain/history-archive';
import { formatDateTime, formatInteger } from '@format/formatters';

interface ArchiveScanDetailProps {
	readonly evidence: PublicHistoryArchiveScanEvidence;
	readonly historyUrl: string;
	readonly logs: readonly PublicHistoryArchiveScanLogEntry[];
	readonly scan: PublicHistoryArchiveScan | null;
}

export function ArchiveScanDetail({
	evidence,
	historyUrl,
	logs,
	scan
}: ArchiveScanDetailProps): React.JSX.Element {
	const archiveErrors = getArchiveVerificationErrors(scan?.errors ?? []);
	const workerIssues = getWorkerIssues(scan?.errors ?? []);
	const activeLog = logs.find(scanLogIsActive) ?? null;
	const latestCompletedLog =
		logs.find((entry) => entry.status === 'completed') ?? null;

	return (
		<section className="detail-grid">
			<article className="panel detail-panel archive-panel">
				<div className="panel-heading">
					<h2>Scanner-owned status</h2>
					<StatusPill
						status={archiveErrors.length > 0 ? 'degraded' : 'ok'}
						text={
							archiveErrors.length > 0 ? 'Archive errors' : 'No archive errors'
						}
					/>
				</div>
				<dl className="details">
					<div>
						<dt>Archive URL</dt>
						<dd>
							<ArchiveTarget url={historyUrl} />
						</dd>
					</div>
					<div>
						<dt>Latest verified</dt>
						<dd>{formatNullableInteger(scan?.latestVerifiedLedger)}</dd>
					</div>
					<div>
						<dt>Latest completed</dt>
						<dd>{formatNullableDate(latestCompletedLog?.endDate ?? null)}</dd>
					</div>
					<div>
						<dt>Active progress</dt>
						<dd>{formatActiveLog(activeLog)}</dd>
					</div>
					<div>
						<dt>Verified buckets</dt>
						<dd>{formatInteger(evidence.count)}</dd>
					</div>
					<div>
						<dt>Metadata captured</dt>
						<dd>
							{formatNullableDate(scan?.archiveMetadata?.observedAt ?? null)}
						</dd>
					</div>
				</dl>
			</article>
			<article className="panel detail-panel archive-panel">
				<div className="panel-heading">
					<h2>Scanner metadata and evidence</h2>
				</div>
				<ArchiveMetadata scan={scan} />
				<EvidenceList
					errors={archiveErrors}
					emptyText="No archive verification errors are recorded for this archive."
					label="Archive evidence"
				/>
				<EvidenceList
					errors={workerIssues}
					emptyText="No worker infrastructure issues are recorded for this archive."
					label="Worker infrastructure"
				/>
				<BucketEvidence evidence={evidence} />
			</article>
			<article className="panel detail-panel archive-panel">
				<div className="panel-heading">
					<h2>Scan run log</h2>
					<span className="muted-inline">
						{formatInteger(logs.length)} rows
					</span>
				</div>
				<HistoryArchiveScanLog logs={logs} />
			</article>
		</section>
	);
}

function ArchiveMetadata({
	scan
}: {
	readonly scan: PublicHistoryArchiveScan | null;
}): React.JSX.Element {
	const archiveMetadata = scan?.archiveMetadata ?? null;

	return (
		<details className="metadata-document" open>
			<summary>
				<span>stellar-history.json</span>
				{archiveMetadata ? (
					<a
						href={archiveMetadata.stellarHistoryUrl}
						rel="noopener noreferrer"
						target="_blank"
					>
						{archiveMetadata.stellarHistoryUrl}
					</a>
				) : (
					<span className="muted-inline">No scanner copy</span>
				)}
			</summary>
			{archiveMetadata ? (
				<>
					<p className="muted-copy">
						Scanner-captured copy observed{' '}
						{formatDateTime(archiveMetadata.observedAt)}.
					</p>
					<pre>{JSON.stringify(archiveMetadata.stellarHistory, null, 2)}</pre>
				</>
			) : (
				<p className="muted-copy">
					No scanner-captured root history metadata is stored for this archive
					yet.
				</p>
			)}
		</details>
	);
}

function EvidenceList({
	emptyText,
	errors,
	label
}: {
	readonly emptyText: string;
	readonly errors: readonly PublicHistoryArchiveScanLogError[];
	readonly label: string;
}): React.JSX.Element {
	if (errors.length === 0) {
		return <p className="muted-copy">{emptyText}</p>;
	}

	return (
		<ul className="archive-error-list compact">
			{errors.map((error, index) => (
				<li key={`${error.type}:${error.url}:${index}`}>
					<ArchiveTarget url={error.url} />
					<span>
						{label}: {sanitizeEvidenceText(error.message)}
					</span>
				</li>
			))}
		</ul>
	);
}

function BucketEvidence({
	evidence
}: {
	readonly evidence: PublicHistoryArchiveScanEvidence;
}): React.JSX.Element {
	return (
		<details className="metadata-document" open={evidence.evidence.length > 0}>
			<summary>
				<span>Verified bucket evidence</span>
				<span className="muted-inline">{formatBucketCount(evidence)}</span>
			</summary>
			{evidence.evidence.length === 0 ? (
				<p className="muted-copy">
					No verified bucket rows have been persisted for this archive yet.
				</p>
			) : (
				<ul className="archive-bucket-evidence-list">
					{evidence.evidence.map((entry) => (
						<li key={`${entry.bucketHash}:${entry.observedAt}`}>
							<ArchiveTarget label={entry.bucketHash} url={entry.bucketUrl} />
							<span>{formatDateTime(entry.observedAt)}</span>
						</li>
					))}
				</ul>
			)}
		</details>
	);
}

function ArchiveTarget({
	label,
	url
}: {
	readonly label?: string;
	readonly url: string;
}): React.JSX.Element {
	if (isPublicHttpUrl(url)) {
		return (
			<a href={url} rel="noopener noreferrer" target="_blank">
				{label ?? url}
			</a>
		);
	}
	if (looksLikeInternalPath(url)) return <span>Internal scanner target</span>;
	return <span>{sanitizeEvidenceText(label ?? url)}</span>;
}

function formatActiveLog(
	entry: PublicHistoryArchiveScanLogEntry | null
): string {
	if (entry === null) return 'No active queue row in the current snapshot';
	return `${entry.status} at ${formatDateTime(entry.updatedAt)}`;
}

function formatBucketCount(evidence: PublicHistoryArchiveScanEvidence): string {
	if (evidence.count === evidence.evidence.length) {
		return `${formatInteger(evidence.count)} verified`;
	}
	return `${formatInteger(evidence.evidence.length)} of ${formatInteger(
		evidence.count
	)} shown`;
}

function formatNullableDate(value: string | null): string {
	return value === null ? 'No data' : formatDateTime(value);
}

function formatNullableInteger(value: number | undefined): string {
	return value === undefined ? 'No data' : formatInteger(value);
}

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

import type {
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanEvidence,
	PublicHistoryArchiveScanLogEntry,
	PublicHistoryArchiveScanLogError,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveState
} from '@api/types';
import { HistoryArchiveScanLog } from '@components/nodes/history-archive-scan-log';
import { StatusPill } from '@components/status/status-ui';
import {
	getArchiveVerificationErrors,
	getWorkerIssues,
	scanLogIsActive
} from '@domain/history-archive';
import { formatDateTime, formatInteger } from '@format/formatters';
import { HistoryArchiveStateDocument } from './history-archive-state-document';
import { HistoryArchiveObjectInventory } from './history-archive-object-inventory';
import { HistoryArchiveObjectEventLog } from './history-archive-object-event-log';

interface ArchiveScanDetailProps {
	readonly evidence: PublicHistoryArchiveScanEvidence;
	readonly events: PublicHistoryArchiveObjectEvents;
	readonly historyUrl: string;
	readonly logs: readonly PublicHistoryArchiveScanLogEntry[];
	readonly objects: PublicHistoryArchiveObjectQueue;
	readonly scan: PublicHistoryArchiveScan | null;
	readonly state: PublicHistoryArchiveState | null;
}

export function ArchiveScanDetail({
	evidence,
	events,
	historyUrl,
	logs,
	objects,
	scan,
	state
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
						<dt>Active worker</dt>
						<dd>{formatActiveStatus(activeLog)}</dd>
					</div>
					<div>
						<dt>Active verified contiguous</dt>
						<dd>{formatActiveVerifiedProgress(activeLog)}</dd>
					</div>
					<div>
						<dt>Active attempted through</dt>
						<dd>{formatActiveAttemptedLedger(activeLog)}</dd>
					</div>
					<div>
						<dt>Active current range</dt>
						<dd>{formatActiveCurrentRange(activeLog)}</dd>
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
				<ArchiveMetadata historyUrl={historyUrl} scan={scan} state={state} />
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
			<HistoryArchiveObjectInventory objects={objects} />
			<HistoryArchiveObjectEventLog events={events} />
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
	historyUrl,
	scan,
	state
}: {
	readonly historyUrl: string;
	readonly scan: PublicHistoryArchiveScan | null;
	readonly state: PublicHistoryArchiveState | null;
}): React.JSX.Element {
	const archiveMetadata = scan?.archiveMetadata ?? null;

	return (
		<HistoryArchiveStateDocument
			archiveState={state}
			archiveMetadata={archiveMetadata}
			archiveUrl={historyUrl}
		/>
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

function formatActiveStatus(
	entry: PublicHistoryArchiveScanLogEntry | null
): string {
	if (entry === null) return 'No active queue row in the current snapshot';
	return `${entry.status} at ${formatDateTime(entry.updatedAt)}`;
}

function formatActiveVerifiedProgress(
	entry: PublicHistoryArchiveScanLogEntry | null
): string {
	if (entry === null) return 'No active queue row in the current snapshot';
	if (entry.latestScannedLedger > 0) {
		return formatInteger(entry.latestScannedLedger);
	}
	return 'No contiguous progress yet';
}

function formatActiveAttemptedLedger(
	entry: PublicHistoryArchiveScanLogEntry | null
): string {
	if (entry === null) return 'No active queue row in the current snapshot';
	if (
		typeof entry.latestAttemptedLedger === 'number' &&
		Number.isFinite(entry.latestAttemptedLedger)
	) {
		return formatInteger(entry.latestAttemptedLedger);
	}
	return 'Not reported yet';
}

function formatActiveCurrentRange(
	entry: PublicHistoryArchiveScanLogEntry | null
): string {
	if (entry === null) return 'No active queue row in the current snapshot';
	if (
		typeof entry.currentRangeFromLedger === 'number' &&
		Number.isFinite(entry.currentRangeFromLedger)
	) {
		const end =
			typeof entry.currentRangeToLedger === 'number' &&
			Number.isFinite(entry.currentRangeToLedger)
				? formatInteger(entry.currentRangeToLedger)
				: 'latest';
		return `${formatInteger(entry.currentRangeFromLedger)}-${end}`;
	}
	return 'No current range reported';
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

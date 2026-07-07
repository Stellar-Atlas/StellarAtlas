import type {
	PublicHistoryArchiveBucketCrossCoverage,
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanEvidence,
	PublicHistoryArchiveScanLogError,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveState
} from '@api/types';
import {
	getArchiveVerificationErrors,
	getWorkerIssues
} from '@domain/history-archive';
import { HistoryArchiveStateDocument } from './history-archive-state-document';
import { HistoryArchiveObjectCoverage } from './history-archive-object-coverage';
import { HistoryArchiveObjectInventory } from './history-archive-object-inventory';
import { HistoryArchiveObjectEventLog } from './history-archive-object-event-log';

interface ArchiveScanDetailProps {
	readonly bucketCoverages: readonly PublicHistoryArchiveBucketCrossCoverage[];
	readonly evidence: PublicHistoryArchiveScanEvidence;
	readonly events: PublicHistoryArchiveObjectEvents;
	readonly historyUrl: string;
	readonly logs: readonly unknown[];
	readonly objects: PublicHistoryArchiveObjectQueue;
	readonly scan: PublicHistoryArchiveScan | null;
	readonly state: PublicHistoryArchiveState | null;
	readonly summary: PublicHistoryArchiveObjectSummary;
}

export function ArchiveScanDetail({
	bucketCoverages,
	events,
	historyUrl,
	objects,
	scan,
	state,
	summary
}: ArchiveScanDetailProps): React.JSX.Element {
	const archiveErrors = getArchiveVerificationErrors(scan?.errors ?? []);
	const workerIssues = getWorkerIssues(scan?.errors ?? []);
	return (
		<section className="detail-grid">
			<HistoryArchiveObjectCoverage
				summary={summary}
				title="Archive file checks"
			/>
			<article className="panel detail-panel archive-panel">
				<div className="panel-heading">
					<h2>History archive state</h2>
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
			</article>
			<HistoryArchiveObjectInventory
				bucketCoverages={bucketCoverages}
				objects={objects}
				title="Archive file-check sample"
			/>
			<HistoryArchiveObjectEventLog
				events={events}
				title="Recent archive file activity"
			/>
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
	if (looksLikeInternalPath(url)) return <span>Stored evidence</span>;
	return <span>{sanitizeEvidenceText(label ?? url)}</span>;
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

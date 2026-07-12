import type {
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveStatusSummary
} from '@api/types';
import { HistoryArchiveObjectEventLog } from '@components/archive-scans/history-archive-object-event-log';
import {
	formatArchiveObjectTypeLabel,
	sanitizeArchiveEvidenceText
} from '@domain/history-archive';
import {
	getArchiveFailureState,
	type ArchiveHealthAssessment,
	type ArchiveHealthState
} from '@domain/history-archive-health';
import { formatDateTime, formatInteger } from '@format/formatters';
import { ArchiveHealthPill } from './status-ui';
import { CheckpointProofGuide } from './checkpoint-proof-guide';
import type { ArchiveSourceFindingPresentation } from './status-dashboard-headlines';

interface StatusArchiveEvidenceTablesProps {
	readonly events: PublicHistoryArchiveObjectEvents;
	readonly eventsAvailable: boolean;
	readonly finding: ArchiveSourceFindingPresentation;
	readonly health: ArchiveHealthAssessment;
	readonly summary: PublicHistoryArchiveStatusSummary;
}

type ArchiveEvent = PublicHistoryArchiveObjectEvents['events'][number];
type ArchiveSource = PublicHistoryArchiveStatusSummary['sources'][number];

export function StatusArchiveEvidenceTables({
	events,
	eventsAvailable,
	finding,
	health,
	summary
}: StatusArchiveEvidenceTablesProps): React.JSX.Element {
	return (
		<section className="panel detail-panel archive-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive source findings</h2>
					<span className="muted-inline">
						External history archive data; updated{' '}
						{formatDateTime(summary.generatedAt)}
					</span>
				</div>
				<ArchiveHealthPill state={health.state} text={finding.pillText} />
			</div>
			<ArchiveFindingSummary finding={finding} />
			<RecentFailureEvidence
				available={eventsAvailable}
				events={events.events}
			/>
			<div className="archive-metadata">
				<ArchiveSourcesDetail summary={summary} />
				<CheckpointProofDetail summary={summary} />
				<ArchiveActivityDetail available={eventsAvailable} events={events} />
			</div>
		</section>
	);
}

function ArchiveFindingSummary({
	finding
}: {
	readonly finding: ArchiveSourceFindingPresentation;
}): React.JSX.Element {
	return (
		<div className="archive-source-finding-summary">
			<strong>{finding.value}</strong>
			<p>{finding.detail}</p>
		</div>
	);
}

function RecentFailureEvidence({
	available,
	events
}: {
	readonly available: boolean;
	readonly events: readonly ArchiveEvent[];
}): React.JSX.Element | null {
	if (!available) {
		return (
			<div className="archive-priority-block">
				<strong>Recent archive activity loading</strong>
				<p>Failure-event drilldown has not loaded yet.</p>
			</div>
		);
	}
	const failedEvents = events
		.filter((event) => event.eventType === 'failed')
		.toSorted(compareFailureEvents);
	if (failedEvents.length === 0) return null;

	const visibleEvents = failedEvents.slice(0, RECENT_FAILURE_LIMIT);
	const remoteFailures = failedEvents.filter(
		(event) => getArchiveFailureState(event.evidenceClass) === 'remote_failure'
	).length;
	const scannerIssues = failedEvents.filter(
		(event) => getArchiveFailureState(event.evidenceClass) === 'scanner_issue'
	).length;

	return (
		<div className="archive-priority-block">
			<div className="archive-table-caption">
				<strong>Recent failure evidence</strong>
				<span>
					{formatInteger(remoteFailures)} remote, {formatInteger(scannerIssues)}{' '}
					scanner; showing {formatInteger(visibleEvents.length)} of{' '}
					{formatInteger(failedEvents.length)}
				</span>
			</div>
			<div className="responsive-table">
				<table className="archive-summary-table">
					<thead>
						<tr>
							<th>Evidence class</th>
							<th>Archive source</th>
							<th>Archive file</th>
							<th>Failure</th>
							<th>Observed</th>
						</tr>
					</thead>
					<tbody>
						{visibleEvents.map((event, index) => (
							<FailureEventRow
								event={event}
								key={`${event.remoteId}:${event.createdAt}:${index}`}
							/>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function FailureEventRow({
	event
}: {
	readonly event: ArchiveEvent;
}): React.JSX.Element {
	const state = getArchiveFailureState(event.evidenceClass);
	return (
		<tr>
			<td>
				<ArchiveHealthPill state={state} />
			</td>
			<td>{formatArchiveSourceLabel(event.archiveUrl)}</td>
			<td>
				<strong>{formatArchiveObjectTypeLabel(event.objectType)}</strong>
				<small>{event.objectKey}</small>
			</td>
			<td>{formatFailureDetail(event)}</td>
			<td>{formatDateTime(event.createdAt)}</td>
		</tr>
	);
}

function ArchiveSourcesDetail({
	summary
}: {
	readonly summary: PublicHistoryArchiveStatusSummary;
}): React.JSX.Element {
	const sources = summary.sources.toSorted(compareArchiveSources);
	const failingSources = sources.filter(isFailingSource).length;

	return (
		<details className="metadata-document">
			<summary>
				<span>Archive sources</span>
				<span className="muted-inline">
					{formatInteger(failingSources)} with findings in{' '}
					{formatInteger(sources.length)} shown /{' '}
					{formatInteger(summary.sourceCount)} captured
				</span>
			</summary>
			<div className="responsive-table">
				<table className="archive-summary-table">
					<thead>
						<tr>
							<th>Archive source</th>
							<th>Failure evidence</th>
							<th>Root state</th>
							<th>Proven checkpoints</th>
							<th>Current work</th>
						</tr>
					</thead>
					<tbody>
						{sources.length > 0 ? (
							sources.map((source) => (
								<ArchiveSourceRow
									key={source.archiveUrlIdentity}
									source={source}
								/>
							))
						) : (
							<tr>
								<td colSpan={5}>No archive sources captured.</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</details>
	);
}

function ArchiveSourceRow({
	source
}: {
	readonly source: ArchiveSource;
}): React.JSX.Element {
	return (
		<tr>
			<td>
				<strong>{formatArchiveSourceLabel(source.archiveUrl)}</strong>
				<small>{formatDateTime(source.observedAt)}</small>
			</td>
			<td>{formatSourceFailure(source)}</td>
			<td>{formatSourceState(source)}</td>
			<td>{formatInteger(source.verifiedCheckpointProofs)}</td>
			<td>
				{formatInteger(source.activeObjectChecks)} checking /{' '}
				{formatInteger(
					source.pendingCheckpointProofs + source.notEvaluableCheckpointProofs
				)}{' '}
				waiting
			</td>
		</tr>
	);
}

function CheckpointProofDetail({
	summary
}: {
	readonly summary: PublicHistoryArchiveStatusSummary;
}): React.JSX.Element {
	const checkpoints = summary.checkpointCoverage;
	return (
		<details className="metadata-document">
			<summary>
				<span>Checkpoint proof detail</span>
				<span className="muted-inline">
					{formatInteger(checkpoints.categoryConsistentArchiveCheckpoints)} of{' '}
					{formatInteger(checkpoints.totalArchiveCheckpoints)} tracked checks
					verified
				</span>
			</summary>
			<div className="responsive-table">
				<table className="archive-checkpoint-proof-table">
					<thead>
						<tr>
							<th>Confirmed mismatch</th>
							<th>Waiting for required files</th>
							<th>Evidence incomplete</th>
							<th>File set complete</th>
							<th>Verified proofs</th>
							<th>Tracked checks</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								{formatInteger(
									checkpoints.categoryConsistencyFailedCheckpoints
								)}
							</td>
							<td>
								{formatInteger(
									checkpoints.categoryConsistencyPendingCheckpoints
								)}
							</td>
							<td>
								{formatInteger(
									checkpoints.categoryConsistencyNotEvaluatedCheckpoints
								)}
							</td>
							<td>
								{formatInteger(checkpoints.objectCompleteArchiveCheckpoints)}
							</td>
							<td>
								{formatInteger(
									checkpoints.categoryConsistentArchiveCheckpoints
								)}
							</td>
							<td>{formatInteger(checkpoints.totalArchiveCheckpoints)}</td>
						</tr>
					</tbody>
				</table>
			</div>
			<CheckpointProofGuide />
		</details>
	);
}

function ArchiveActivityDetail({
	available,
	events
}: {
	readonly available: boolean;
	readonly events: PublicHistoryArchiveObjectEvents;
}): React.JSX.Element {
	return (
		<details className="metadata-document">
			<summary>
				<span>Recent archive activity</span>
				<span className="muted-inline">
					{available ? `${formatInteger(events.count)} events` : 'Loading'}
				</span>
			</summary>
			{available ? (
				<HistoryArchiveObjectEventLog
					events={events}
					framed={false}
					title="Archive file activity"
				/>
			) : (
				<p className="muted-copy">Recent archive activity is loading.</p>
			)}
		</details>
	);
}

function compareFailureEvents(left: ArchiveEvent, right: ArchiveEvent): number {
	const classOrder =
		failureStateOrder(getArchiveFailureState(left.evidenceClass)) -
		failureStateOrder(getArchiveFailureState(right.evidenceClass));
	if (classOrder !== 0) return classOrder;
	return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function failureStateOrder(state: ArchiveHealthState): number {
	if (state === 'remote_failure') return 0;
	if (state === 'scanner_issue') return 1;
	return 2;
}

function compareArchiveSources(
	left: ArchiveSource,
	right: ArchiveSource
): number {
	const failureOrder =
		Number(isFailingSource(right)) - Number(isFailingSource(left));
	if (failureOrder !== 0) return failureOrder;
	return right.mismatchCheckpointProofs - left.mismatchCheckpointProofs;
}

function isFailingSource(source: ArchiveSource): boolean {
	return (
		source.mismatchCheckpointProofs > 0 ||
		source.archiveEvidenceFailures > 0 ||
		source.scannerIssueFailures > 0 ||
		source.unclassifiedFailures > 0 ||
		source.stateStatus === 'invalid' ||
		source.stateStatus === 'unreachable'
	);
}

function formatSourceFailure(source: ArchiveSource): string {
	if (source.mismatchCheckpointProofs > 0) {
		return `${formatInteger(source.mismatchCheckpointProofs)} proof mismatches`;
	}
	if (source.archiveEvidenceFailures > 0) {
		return `${formatInteger(source.archiveEvidenceFailures)} remote archive failures`;
	}
	if (source.scannerIssueFailures > 0) {
		return `${formatInteger(source.scannerIssueFailures)} scanner issues`;
	}
	if (source.unclassifiedFailures > 0) {
		return `${formatInteger(source.unclassifiedFailures)} unclassified legacy failures`;
	}
	if (
		source.rootObjectStatus === 'failed' &&
		source.rootFailureChannel === 'archive_evidence'
	) {
		return 'Remote root check failed';
	}
	if (
		source.rootObjectStatus === 'failed' &&
		source.rootFailureChannel === 'scanner_issue'
	) {
		return 'Root scanner issue';
	}
	if (source.stateStatus === 'invalid') return 'State file invalid';
	if (source.stateStatus === 'unreachable') return 'Source unreachable';
	return 'None observed';
}

function formatSourceState(source: ArchiveSource): string {
	const rootState = source.rootObjectStatus ?? 'not queued';
	return `${source.stateStatus}; root ${rootState}`;
}

function formatFailureDetail(event: ArchiveEvent): string {
	if (event.error === null) return 'Failure detail not recorded';
	const status =
		event.error.httpStatus === null ? '' : `HTTP ${event.error.httpStatus}: `;
	return status + sanitizeArchiveEvidenceText(event.error.message);
}

export function formatArchiveSourceLabel(value: string): string {
	try {
		const url = new URL(value);
		const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
		return `${url.protocol}//${url.host}${path}`;
	} catch {
		return sanitizeArchiveEvidenceText(value);
	}
}

const RECENT_FAILURE_LIMIT = 5;

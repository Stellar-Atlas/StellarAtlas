import type {
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveObjectTypeSummary
} from '@api/types';
import { HistoryArchiveObjectEventLog } from '@components/archive-scans/history-archive-object-event-log';
import {
	formatArchiveObjectTypeGroupLabel,
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

interface StatusArchiveEvidenceTablesProps {
	readonly events: PublicHistoryArchiveObjectEvents;
	readonly health: ArchiveHealthAssessment;
	readonly summary: PublicHistoryArchiveObjectSummary;
}

type ArchiveEvent = PublicHistoryArchiveObjectEvents['events'][number];
type ArchiveSource = PublicHistoryArchiveObjectSummary['sources'][number];

export function StatusArchiveEvidenceTables({
	events,
	health,
	summary
}: StatusArchiveEvidenceTablesProps): React.JSX.Element {
	return (
		<section className="panel detail-panel archive-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive evidence</h2>
					<span className="muted-inline">
						Updated {formatDateTime(summary.generatedAt)}
					</span>
				</div>
				<ArchiveHealthPill state={health.state} />
			</div>
			<ArchiveEvidenceSummary health={health} />
			<RecentFailureEvidence events={events.events} />
			<div className="archive-metadata">
				<ArchiveSourcesDetail summary={summary} />
				<CheckpointProofDetail summary={summary} />
				<ObjectTypeDetail objectTypes={summary.objectTypes} />
				<ArchiveActivityDetail events={events} />
			</div>
		</section>
	);
}

function ArchiveEvidenceSummary({
	health
}: {
	readonly health: ArchiveHealthAssessment;
}): React.JSX.Element {
	const facts = health.facts;
	return (
		<div className="responsive-table archive-summary-table-wrap">
			<table className="archive-summary-table">
				<thead>
					<tr>
						<th>Current archive failures</th>
						<th>Scanner issues</th>
						<th>Checkpoint proof</th>
						<th>Checking</th>
						<th>Waiting</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>{formatRemoteFailureSummary(health)}</td>
						<td>{formatScannerIssueSummary(health)}</td>
						<td>
							{formatInteger(facts.provenCheckpointProofs)} /{' '}
							{formatInteger(facts.expectedCheckpointProofs)} verified
						</td>
						<td>{formatInteger(facts.activeChecks)}</td>
						<td>{formatInteger(facts.waitingChecks)}</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}

function RecentFailureEvidence({
	events
}: {
	readonly events: readonly ArchiveEvent[];
}): React.JSX.Element | null {
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
			<td>{formatArchiveSource(event.archiveUrl)}</td>
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
	readonly summary: PublicHistoryArchiveObjectSummary;
}): React.JSX.Element {
	const sources = summary.sources.toSorted(compareArchiveSources);
	const failingSources = sources.filter(isFailingSource).length;

	return (
		<details className="metadata-document">
			<summary>
				<span>Archive sources</span>
				<span className="muted-inline">
					{formatInteger(failingSources)} failing /{' '}
					{formatInteger(sources.length)} captured
				</span>
			</summary>
			<div className="responsive-table">
				<table className="archive-summary-table">
					<thead>
						<tr>
							<th>Archive source</th>
							<th>Remote failure</th>
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
				<strong>{formatArchiveSource(source.archiveUrl)}</strong>
				<small>{formatDateTime(source.observedAt)}</small>
			</td>
			<td>{formatSourceFailure(source)}</td>
			<td>{formatSourceState(source)}</td>
			<td>{formatInteger(source.verifiedCheckpoints)}</td>
			<td>
				{formatInteger(source.activeObjects)} checking /{' '}
				{formatInteger(source.pendingObjects)} waiting
			</td>
		</tr>
	);
}

function CheckpointProofDetail({
	summary
}: {
	readonly summary: PublicHistoryArchiveObjectSummary;
}): React.JSX.Element {
	const checkpoints = summary.checkpoints;
	return (
		<details className="metadata-document">
			<summary>
				<span>Checkpoint proof detail</span>
				<span className="muted-inline">
					{formatInteger(checkpoints.categoryConsistentArchiveCheckpoints)} /{' '}
					{formatInteger(checkpoints.expectedArchiveCheckpoints)} verified
				</span>
			</summary>
			<div className="responsive-table">
				<table className="archive-checkpoint-proof-table">
					<thead>
						<tr>
							<th>Hash mismatch</th>
							<th>Missing checkpoints</th>
							<th>Proof facts incomplete</th>
							<th>Waiting for files</th>
							<th>File set complete</th>
							<th>Verified proofs</th>
							<th>Expected</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								{formatInteger(
									checkpoints.categoryConsistencyFailedCheckpoints
								)}
							</td>
							<td>{formatInteger(checkpoints.missingArchiveCheckpoints)}</td>
							<td>
								{formatInteger(
									checkpoints.categoryConsistencyNotEvaluatedCheckpoints
								)}
							</td>
							<td>
								{formatInteger(
									checkpoints.categoryConsistencyPendingCheckpoints
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
							<td>{formatInteger(checkpoints.expectedArchiveCheckpoints)}</td>
						</tr>
					</tbody>
				</table>
			</div>
			<CheckpointProofGuide />
		</details>
	);
}

function ObjectTypeDetail({
	objectTypes
}: {
	readonly objectTypes: readonly PublicHistoryArchiveObjectTypeSummary[];
}): React.JSX.Element | null {
	if (objectTypes.length === 0) return null;
	return (
		<details className="metadata-document">
			<summary>
				<span>Archive file groups</span>
				<span className="muted-inline">
					{formatInteger(objectTypes.length)} groups
				</span>
			</summary>
			<div className="responsive-table">
				<table className="archive-object-type-table">
					<thead>
						<tr>
							<th>File group</th>
							<th>Failed</th>
							<th>Verified</th>
							<th>Checking</th>
							<th>Waiting</th>
						</tr>
					</thead>
					<tbody>
						{objectTypes.map((entry) => (
							<ObjectTypeRow entry={entry} key={entry.objectType} />
						))}
					</tbody>
				</table>
			</div>
		</details>
	);
}

function ObjectTypeRow({
	entry
}: {
	readonly entry: PublicHistoryArchiveObjectTypeSummary;
}): React.JSX.Element {
	return (
		<tr>
			<td>{formatArchiveObjectTypeGroupLabel(entry.objectType)}</td>
			<td>{formatInteger(entry.failedObjects)}</td>
			<td>{formatInteger(entry.verifiedObjects)}</td>
			<td>{formatInteger(entry.activeObjects)}</td>
			<td>{formatInteger(entry.pendingObjects)}</td>
		</tr>
	);
}

function ArchiveActivityDetail({
	events
}: {
	readonly events: PublicHistoryArchiveObjectEvents;
}): React.JSX.Element {
	return (
		<details className="metadata-document">
			<summary>
				<span>Recent archive activity</span>
				<span className="muted-inline">
					{formatInteger(events.count)} events
				</span>
			</summary>
			<HistoryArchiveObjectEventLog
				events={events}
				framed={false}
				title="Archive file activity"
			/>
		</details>
	);
}

function formatRemoteFailureSummary(health: ArchiveHealthAssessment): string {
	const facts = health.facts;
	if (facts.checkpointMismatches > 0) {
		return `${formatInteger(facts.checkpointMismatches)} checkpoint mismatches`;
	}
	if (facts.failedEvidenceRows > 0) {
		return `${formatInteger(facts.failedEvidenceRows)} failed evidence rows`;
	}
	if (facts.failingArchiveSources > 0) {
		return `${formatInteger(facts.failingArchiveSources)} failing sources`;
	}
	if (facts.remoteHostFailures > 0) {
		return `${formatInteger(facts.remoteHostFailures)} remote host failures`;
	}
	return 'None observed';
}

function formatScannerIssueSummary(health: ArchiveHealthAssessment): string {
	return health.facts.scannerIssues > 0
		? `${formatInteger(health.facts.scannerIssues)} infrastructure issues`
		: 'None observed';
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
	return right.failedObjects - left.failedObjects;
}

function isFailingSource(source: ArchiveSource): boolean {
	return (
		source.failedObjects > 0 ||
		source.rootObjectStatus === 'failed' ||
		source.stateStatus === 'invalid' ||
		source.stateStatus === 'unreachable'
	);
}

function formatSourceFailure(source: ArchiveSource): string {
	if (source.failedObjects > 0) {
		return `${formatInteger(source.failedObjects)} failed evidence rows`;
	}
	if (source.rootObjectStatus === 'failed') return 'Root check failed';
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

function formatArchiveSource(value: string): string {
	try {
		const url = new URL(value);
		const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
		return `${url.host}${path}`;
	} catch {
		return sanitizeArchiveEvidenceText(value);
	}
}

const RECENT_FAILURE_LIMIT = 5;

'use client';

import { useState } from 'react';
import Link from 'next/link';
import type {
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveStatusSummary
} from '@api/types';
import { HistoryArchiveObjectEventLog } from '@components/archive-scans/history-archive-object-event-log';
import { formatArchiveObjectTypeLabel } from '@domain/history-archive';
import {
	getArchiveFailureState,
	type ArchiveHealthAssessment,
	type ArchiveHealthState
} from '@domain/history-archive-health';
import { formatInteger } from '@format/formatters';
import { useLocalDateTimeFormatter } from '../local-date-time';
import { ArchiveHealthPill } from './status-ui';
import { CheckpointProofGuide } from './checkpoint-proof-guide';
import type { ArchiveSourceFindingPresentation } from './status-dashboard-headlines';
import {
	getStatusTablePage,
	StatusTablePagination
} from './status-table-pagination';

import {
	hasIntegrityMismatch,
	formatSourceIntegrity,
	formatRemoteAvailability,
	formatCheckpointCoverage,
	formatSourceState,
	formatFailureDetail,
	formatArchiveSourceLabel
} from './archive-status-formatters';
export {
	formatArchiveFailureDetail,
	formatArchiveSourceLabel
} from './archive-status-formatters';

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
	const formatDateTime = useLocalDateTimeFormatter();
	return (
		<section className="panel detail-panel archive-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive verification evidence</h2>
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
	const [page, setPage] = useState(0);
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

	const failurePage = getStatusTablePage(
		failedEvents,
		page,
		RECENT_FAILURE_PAGE_SIZE
	);
	const remoteFailures = failedEvents.filter(
		(event) => getArchiveFailureState(event.evidenceClass) === 'remote_retry'
	).length;
	const scannerIssues = failedEvents.filter(
		(event) => getArchiveFailureState(event.evidenceClass) === 'scanner_issue'
	).length;

	return (
		<div className="archive-priority-block">
			<div className="archive-table-caption">
				<strong>Recent unresolved file checks</strong>
				<span>
					{formatInteger(remoteFailures)} remote retries,{' '}
					{formatInteger(scannerIssues)} scanner issues; showing{' '}
					{formatInteger(failurePage.rows.length)} of{' '}
					{formatInteger(failedEvents.length)}
				</span>
			</div>
			<div className="responsive-table">
				<table className="archive-summary-table">
					<thead>
						<tr>
							<th>Check type</th>
							<th>Archive source</th>
							<th>Archive file</th>
							<th>Observed result</th>
							<th>Observed</th>
						</tr>
					</thead>
					<tbody>
						{failurePage.rows.map((event, index) => (
							<FailureEventRow
								event={event}
								key={`${event.remoteId}:${event.createdAt}:${index}`}
							/>
						))}
					</tbody>
				</table>
			</div>
			<StatusTablePagination
				label="Recent archive failure pages"
				onPageChange={setPage}
				page={failurePage.page}
				pageSize={RECENT_FAILURE_PAGE_SIZE}
				totalRows={failedEvents.length}
			/>
		</div>
	);
}

function FailureEventRow({
	event
}: {
	readonly event: ArchiveEvent;
}): React.JSX.Element {
	const formatDateTime = useLocalDateTimeFormatter();
	const state = getArchiveFailureState(event.evidenceClass);
	return (
		<tr>
			<td data-label="Check type">
				<ArchiveHealthPill
					state={state}
					text={state === 'remote_retry' ? 'Remote retry' : undefined}
				/>
			</td>
			<td data-label="Archive source">
				{formatArchiveSourceLabel(event.archiveUrl)}
			</td>
			<td data-label="Archive file">
				<strong>{formatArchiveObjectTypeLabel(event.objectType)}</strong>
				<small>{event.objectKey}</small>
			</td>
			<td data-label="Observed result">{formatFailureDetail(event)}</td>
			<td data-label="Observed">{formatDateTime(event.createdAt)}</td>
		</tr>
	);
}

function ArchiveSourcesDetail({
	summary
}: {
	readonly summary: PublicHistoryArchiveStatusSummary;
}): React.JSX.Element {
	const sources = summary.sources.toSorted(compareArchiveSources);
	const mismatchSources = sources.filter(hasIntegrityMismatch).length;
	const sourcesWithCoverage = sources.filter(
		(source) => source.verifiedCheckpointProofs > 0
	).length;
	const sourcesAwaitingRetry = sources.filter(
		(source) => source.archiveEvidenceFailures > 0
	).length;
	const [page, setPage] = useState(0);
	const sourcePage = getStatusTablePage(
		sources,
		page,
		ARCHIVE_SOURCE_PAGE_SIZE
	);

	return (
		<details className="metadata-document">
			<summary>
				<span>Archive sources</span>
				<span className="muted-inline">
					{formatInteger(sourcesWithCoverage)} / {formatInteger(sources.length)}{' '}
					with verified coverage; {formatInteger(mismatchSources)} confirmed
					mismatches; {formatInteger(sourcesAwaitingRetry)} awaiting remote
					retries
				</span>
			</summary>
			<Link className="archive-inventory-link" href="/archives">
				Open the complete archive-root inventory
			</Link>
			<div className="responsive-table">
				<table className="archive-summary-table">
					<thead>
						<tr>
							<th>Archive source</th>
							<th>Integrity proof</th>
							<th>Remote availability</th>
							<th>Root state</th>
							<th>Checkpoint coverage</th>
							<th>Proof work</th>
						</tr>
					</thead>
					<tbody>
						{sources.length > 0 ? (
							sourcePage.rows.map((source) => (
								<ArchiveSourceRow
									key={source.archiveUrlIdentity}
									source={source}
								/>
							))
						) : (
							<tr>
								<td colSpan={6}>No archive sources captured.</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
			<StatusTablePagination
				label="Archive source pages"
				onPageChange={setPage}
				page={sourcePage.page}
				pageSize={ARCHIVE_SOURCE_PAGE_SIZE}
				totalRows={sources.length}
			/>
		</details>
	);
}

function ArchiveSourceRow({
	source
}: {
	readonly source: ArchiveSource;
}): React.JSX.Element {
	const formatDateTime = useLocalDateTimeFormatter();
	return (
		<tr>
			<td data-label="Archive source">
				<strong>{formatArchiveSourceLabel(source.archiveUrl)}</strong>
				<small>{formatDateTime(source.observedAt)}</small>
			</td>
			<td data-label="Integrity proof">{formatSourceIntegrity(source)}</td>
			<td data-label="Remote availability">
				{formatRemoteAvailability(source)}
			</td>
			<td data-label="Root state">{formatSourceState(source)}</td>
			<td data-label="Checkpoint coverage">
				{formatCheckpointCoverage(source)}
			</td>
			<td data-label="Proof work">
				{formatInteger(source.activeObjectChecks)} active;{' '}
				{formatInteger(source.pendingCheckpointProofs)} waiting for files;{' '}
				{formatInteger(source.notEvaluableCheckpointProofs)} incomplete
				{source.scannerIssueFailures > 0
					? `; ${formatInteger(source.scannerIssueFailures)} scanner-side checks awaiting retry`
					: ''}
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
	const canonical = summary.canonicalProofProgress;
	return (
		<details className="metadata-document">
			<summary>
				<span>Checkpoint proof detail</span>
				<span className="muted-inline">
					{formatInteger(checkpoints.categoryConsistentArchiveCheckpoints)}{' '}
					verified root-checkpoint attestations across{' '}
					{formatInteger(checkpoints.totalArchiveCheckpoints)} materialized
					root-checkpoint observations
				</span>
			</summary>
			<div className="canonical-proof-progress">
				<div>
					<strong>Canonical proof frontier</strong>
					<span className="muted-inline">
						{formatInteger(canonical.verifiedCheckpoints)} of{' '}
						{formatInteger(canonical.totalCheckpoints)} unique checkpoint
						positions proven
					</span>
				</div>
				<progress
					aria-label="Canonical checkpoint proof progress"
					max={Math.max(1, canonical.totalCheckpoints)}
					value={canonical.verifiedCheckpoints}
				/>
				<p className="muted-copy">
					Each checkpoint is counted once, independent of archive-root
					attestations. Latest contiguous proof ledger:{' '}
					{canonical.latestVerifiedCheckpointLedger === null
						? 'none'
						: formatInteger(canonical.latestVerifiedCheckpointLedger)}
					; next checkpoint:{' '}
					{canonical.nextCheckpointLedger === null
						? 'caught up'
						: formatInteger(canonical.nextCheckpointLedger)}
					; remaining: {formatInteger(canonical.remainingCheckpoints)}.
				</p>
			</div>
			<p className="muted-copy">
				The table below counts each archive root separately. It measures remote
				availability and agreement, not the number of unique canonical proofs.
			</p>
			<div className="responsive-table">
				<table className="archive-checkpoint-proof-table">
					<thead>
						<tr>
							<th>Root observations with mismatch</th>
							<th>Root observations waiting for files</th>
							<th>Root observations not evaluated</th>
							<th>Root observations file-complete</th>
							<th>Root attestations verified</th>
							<th>Materialized root-checkpoint observations</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td data-label="Root observations with mismatch">
								{formatInteger(
									checkpoints.categoryConsistencyFailedCheckpoints
								)}
							</td>
							<td data-label="Root observations waiting for files">
								{formatInteger(
									checkpoints.categoryConsistencyPendingCheckpoints
								)}
							</td>
							<td data-label="Root observations not evaluated">
								{formatInteger(
									checkpoints.categoryConsistencyNotEvaluatedCheckpoints
								)}
							</td>
							<td data-label="Root observations file-complete">
								{formatInteger(checkpoints.objectCompleteArchiveCheckpoints)}
							</td>
							<td data-label="Root attestations verified">
								{formatInteger(
									checkpoints.categoryConsistentArchiveCheckpoints
								)}
							</td>
							<td data-label="Materialized root-checkpoint observations">
								{formatInteger(checkpoints.totalArchiveCheckpoints)}
							</td>
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
	if (state === 'remote_retry') return 0;
	if (state === 'scanner_issue') return 1;
	return 2;
}

function compareArchiveSources(
	left: ArchiveSource,
	right: ArchiveSource
): number {
	const mismatchOrder =
		right.mismatchCheckpointProofs - left.mismatchCheckpointProofs;
	if (mismatchOrder !== 0) return mismatchOrder;
	const coverageOrder =
		right.verifiedCheckpointProofs - left.verifiedCheckpointProofs;
	if (coverageOrder !== 0) return coverageOrder;
	return left.archiveUrl.localeCompare(right.archiveUrl);
}

const ARCHIVE_SOURCE_PAGE_SIZE = 10;
const RECENT_FAILURE_PAGE_SIZE = 5;

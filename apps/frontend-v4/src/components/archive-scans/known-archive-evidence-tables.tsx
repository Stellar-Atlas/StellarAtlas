import type {
	PublicHistoryArchiveObjectEventPage,
	PublicHistoryArchiveObjectPage,
	PublicKnownArchiveRemoteFailurePage,
	PublicKnownArchiveRootEvidence,
	PublicKnownArchiveWorkerIssuePage
} from '@api/archive-evidence-types';
import {
	formatArchiveObjectType,
	formatArchiveRoot
} from '@domain/known-archive-evidence';
import { formatDateTime, formatInteger } from '@format/formatters';
import {
	ArchiveSourceLink,
	EmptyEvidenceRow,
	EvidenceTableRegion,
	ExternalEvidenceLink,
	ObjectIdentity,
	ObjectSource,
	VerifiedCopyLinks,
	formatArchiveState,
	formatBytes,
	formatEvidenceClass,
	formatEventType,
	formatObjectError,
	formatObjectStatus,
	formatObjectStatusDetail,
	formatWorkerStage,
	sanitizeEvidenceMessage
} from './known-archive-evidence-table-parts';

export function RemoteFailureTable({
	page
}: {
	readonly page: PublicKnownArchiveRemoteFailurePage;
}): React.JSX.Element {
	if (page.failures.length === 0)
		return <EmptyEvidenceRow text="No remote failures." />;
	return (
		<EvidenceTableRegion label="Remote archive failures">
			<table className="known-evidence-table failure-table">
				<thead>
					<tr>
						<th>Failed file</th>
						<th>Failure</th>
						<th>Archive source</th>
						<th>Same organization</th>
						<th>Network</th>
						<th>Observed</th>
					</tr>
				</thead>
				<tbody>
					{page.failures.map((failure) => (
						<tr key={failure.object.remoteId}>
							<td data-label="Failed file">
								<ObjectIdentity object={failure.object} />
							</td>
							<td className="known-evidence-error" data-label="Failure">
								{formatObjectError(failure.object)}
							</td>
							<td data-label="Archive source">
								<ObjectSource object={failure.object} />
							</td>
							<td data-label="Same organization">
								<VerifiedCopyLinks
									failure={failure}
									relation="same-organization"
								/>
							</td>
							<td data-label="Network">
								<VerifiedCopyLinks failure={failure} relation="network" />
							</td>
							<td data-label="Observed">
								{formatDateTime(failure.object.updatedAt)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</EvidenceTableRegion>
	);
}

export function WorkerIssueTable({
	page
}: {
	readonly page: PublicKnownArchiveWorkerIssuePage;
}): React.JSX.Element {
	if (page.issues.length === 0) {
		return <EmptyEvidenceRow text="No StellarAtlas worker issues." />;
	}
	return (
		<EvidenceTableRegion
			className="worker-issue-table"
			label="StellarAtlas worker issues"
		>
			<table className="known-evidence-table">
				<thead>
					<tr>
						<th>Infrastructure issue</th>
						<th>Stage</th>
						<th>File</th>
						<th>Archive source</th>
						<th>Observed</th>
					</tr>
				</thead>
				<tbody>
					{page.issues.map((issue) => (
						<tr key={issue.object.remoteId}>
							<td data-label="Infrastructure issue">
								<strong>{formatEvidenceClass(issue.evidenceClass)}</strong>
								<small>{formatObjectError(issue.object)}</small>
							</td>
							<td data-label="Stage">
								{formatWorkerStage(issue.object.workerStage)}
							</td>
							<td data-label="File">
								<ObjectIdentity object={issue.object} />
							</td>
							<td data-label="Archive source">
								<ObjectSource object={issue.object} />
							</td>
							<td data-label="Observed">
								{formatDateTime(issue.object.updatedAt)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</EvidenceTableRegion>
	);
}

export function ArchiveObjectPageTable({
	page
}: {
	readonly page: PublicHistoryArchiveObjectPage;
}): React.JSX.Element {
	if (page.objects.length === 0)
		return <EmptyEvidenceRow text="No matching files." />;
	return (
		<EvidenceTableRegion label="Archive files">
			<table className="known-evidence-table object-page-table">
				<thead>
					<tr>
						<th>File</th>
						<th>Archive source</th>
						<th>Status</th>
						<th>Attempt</th>
						<th>Size</th>
						<th>Updated</th>
					</tr>
				</thead>
				<tbody>
					{page.objects.map((object) => (
						<tr key={object.remoteId}>
							<td data-label="File">
								<ObjectIdentity object={object} />
							</td>
							<td data-label="Archive source">
								<ObjectSource object={object} />
							</td>
							<td data-label="Status">
								<strong className={`evidence-status ${object.status}`}>
									{formatObjectStatus(object)}
								</strong>
								<small>{formatObjectStatusDetail(object)}</small>
							</td>
							<td data-label="Attempt">{formatInteger(object.attempts)}</td>
							<td data-label="Size">{formatBytes(object.bytesDownloaded)}</td>
							<td data-label="Updated">
								{formatDateTime(object.verifiedAt ?? object.updatedAt)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</EvidenceTableRegion>
	);
}

export function ArchiveActivityTable({
	page
}: {
	readonly page: PublicHistoryArchiveObjectEventPage;
}): React.JSX.Element {
	if (page.events.length === 0)
		return <EmptyEvidenceRow text="No matching activity." />;
	return (
		<EvidenceTableRegion label="Archive evidence activity">
			<table className="known-evidence-table activity-table">
				<thead>
					<tr>
						<th>Event</th>
						<th>Evidence class</th>
						<th>File</th>
						<th>Archive source</th>
						<th>Stage</th>
						<th>Time</th>
					</tr>
				</thead>
				<tbody>
					{page.events.map((event) => (
						<tr key={event.remoteId}>
							<td data-label="Event">
								<strong>{formatEventType(event.eventType)}</strong>
								<small>
									{event.error
										? sanitizeEvidenceMessage(event.error.message)
										: null}
								</small>
							</td>
							<td data-label="Evidence class">
								{event.evidenceClass
									? formatEvidenceClass(event.evidenceClass)
									: 'Not classified'}
							</td>
							<td data-label="File">
								<strong>{formatArchiveObjectType(event.objectType)}</strong>
								<small>{event.objectKey}</small>
							</td>
							<td data-label="Archive source">
								<ArchiveSourceLink archiveUrl={event.archiveUrl}>
									{formatArchiveRoot(event.archiveUrl)}
								</ArchiveSourceLink>
							</td>
							<td data-label="Stage">{formatWorkerStage(event.workerStage)}</td>
							<td data-label="Time">{formatDateTime(event.createdAt)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</EvidenceTableRegion>
	);
}

export function RepairDownloadTable({
	page
}: {
	readonly page: PublicKnownArchiveRemoteFailurePage;
}): React.JSX.Element {
	if (page.failures.length === 0) {
		return <EmptyEvidenceRow text="No failed files need a replacement copy." />;
	}
	return (
		<EvidenceTableRegion label="Verified replacement downloads">
			<table className="known-evidence-table repair-download-table">
				<caption>
					Replacement downloads appear only when another archive source has
					verified evidence for the same canonical file.
				</caption>
				<thead>
					<tr>
						<th>Failed file</th>
						<th>Unverified remote location</th>
						<th>Verified organization replacements</th>
						<th>Verified network replacements</th>
					</tr>
				</thead>
				<tbody>
					{page.failures.map((failure) => (
						<tr key={failure.object.remoteId}>
							<td data-label="Failed file">
								<ObjectIdentity object={failure.object} />
							</td>
							<td data-label="Unverified remote location">
								<ExternalEvidenceLink href={failure.object.objectUrl}>
									Inspect failed remote URL
								</ExternalEvidenceLink>
								<small>Not a verified replacement</small>
							</td>
							<td data-label="Verified organization replacements">
								<VerifiedCopyLinks
									failure={failure}
									relation="same-organization"
									verbose
								/>
							</td>
							<td data-label="Verified network replacements">
								<VerifiedCopyLinks
									failure={failure}
									relation="network"
									verbose
								/>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</EvidenceTableRegion>
	);
}

export function ArchiveRootSummaryTable({
	roots
}: {
	readonly roots: readonly PublicKnownArchiveRootEvidence[];
}): React.JSX.Element {
	if (roots.length === 0)
		return <EmptyEvidenceRow text="No archive sources are known." />;
	return (
		<EvidenceTableRegion label="Archive source summary">
			<table className="known-evidence-table root-summary-table">
				<thead>
					<tr>
						<th>Archive source</th>
						<th>Nodes</th>
						<th>State</th>
						<th>Files</th>
						<th>Remote failures</th>
						<th>Worker issues</th>
						<th>Checkpoint file consistency</th>
					</tr>
				</thead>
				<tbody>
					{roots.map((root) => (
						<tr key={root.archiveUrlIdentity}>
							<td data-label="Archive source">
								<ArchiveSourceLink archiveUrl={root.archiveUrl}>
									{formatArchiveRoot(root.archiveUrl)}
								</ArchiveSourceLink>
							</td>
							<td data-label="Nodes">
								{formatInteger(root.nodePublicKeys.length)}
							</td>
							<td data-label="State">{formatArchiveState(root)}</td>
							<td data-label="Files">
								{formatInteger(root.objects.verifiedObjects)} /{' '}
								{formatInteger(root.objects.totalObjects)} verified
							</td>
							<td
								data-label="Remote failures"
								className={
									root.objects.remoteFailureObjects > 0
										? 'known-evidence-error'
										: ''
								}
							>
								{formatInteger(root.objects.remoteFailureObjects)}
							</td>
							<td data-label="Worker issues">
								{formatInteger(root.objects.workerIssueObjects)}
							</td>
							<td data-label="Checkpoint file consistency">
								<strong>
									{formatInteger(root.checkpoints.verifiedCheckpoints)} /{' '}
									{formatInteger(root.checkpoints.totalCheckpoints)} passed
								</strong>
								<small>{formatCheckpointWork(root)}</small>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</EvidenceTableRegion>
	);
}

function formatCheckpointWork(root: PublicKnownArchiveRootEvidence): string {
	const checkpoints = root.checkpoints;
	const parts = [
		checkpoints.pendingCheckpoints > 0
			? `${formatInteger(checkpoints.pendingCheckpoints)} waiting for required files`
			: null,
		checkpoints.notEvaluableCheckpoints > 0
			? `${formatInteger(checkpoints.notEvaluableCheckpoints)} awaiting proof data`
			: null,
		checkpoints.mismatchedCheckpoints > 0
			? `${formatInteger(checkpoints.mismatchedCheckpoints)} file mismatches`
			: null
	].filter((part): part is string => part !== null);

	return parts.length === 0
		? 'No incomplete checkpoint checks'
		: parts.join('; ');
}

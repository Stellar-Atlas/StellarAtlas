import type {
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveObjectTypeSummary,
	PublicStatusLevel
} from '@api/types';
import { formatArchiveObjectTypeGroupLabel } from '@domain/history-archive';
import {
	formatDateTime,
	formatInteger,
	formatPercent
} from '@format/formatters';
import { StatusPill } from './status-ui';

interface StatusArchiveEvidenceTablesProps {
	readonly summary: PublicHistoryArchiveObjectSummary;
}

type ArchiveSourceSummary = PublicHistoryArchiveObjectSummary['sources'][number];

export function StatusArchiveEvidenceTables({
	summary
}: StatusArchiveEvidenceTablesProps): React.JSX.Element {
	return (
		<>
			<ArchiveRootPanel summary={summary} />
			<ArchiveObjectQueuePanel summary={summary} />
			<CheckpointProofPanel summary={summary} />
		</>
	);
}

function ArchiveRootPanel({
	summary
}: {
	readonly summary: PublicHistoryArchiveObjectSummary;
}): React.JSX.Element {
	const checkpoints = summary.checkpoints;
	const sources = summary.sources;

	return (
		<section className="panel detail-panel archive-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive sources</h2>
					<span className="muted-inline">
						Updated {formatDateTime(summary.generatedAt)}
					</span>
				</div>
				<StatusPill
					status={getArchiveRootStatus(summary)}
					text={formatArchiveRootStatus(summary)}
				/>
			</div>
			<div className="responsive-table archive-summary-table-wrap">
				<table className="archive-summary-table">
					<thead>
						<tr>
							<th>Archive source</th>
							<th>History archive state</th>
							<th>Latest checkpoint</th>
							<th>Discovered through</th>
							<th>Root state check</th>
							<th>File checks</th>
							<th>Failures</th>
						</tr>
					</thead>
					<tbody>
						{sources.length > 0 ? (
							sources.map((source) => (
								<ArchiveSourceRow key={source.archiveUrlIdentity} source={source} />
							))
						) : (
							<tr>
								<td colSpan={7}>No scanner-captured archive sources yet.</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
			<ArchiveSourceCoverageDetails
				latestCheckpoint={checkpoints.latestCheckpointLedger}
				oldestCheckpoint={checkpoints.oldestCheckpointLedger}
				summary={summary}
			/>
		</section>
	);
}

function ArchiveSourceRow({
	source
}: {
	readonly source: ArchiveSourceSummary;
}): React.JSX.Element {
	return (
		<tr>
			<td>{formatArchiveSource(source.archiveUrl)}</td>
			<td>
				<strong>{formatHistoryArchiveState(source.stateStatus)}</strong>
				<small>{formatDateTime(source.observedAt)}</small>
			</td>
			<td>{formatLedger(source.latestCheckpointLedger)}</td>
			<td>{formatLedger(source.latestDiscoveredCheckpointLedger)}</td>
			<td>{formatRootObjectStatus(source.rootObjectStatus)}</td>
			<td>
				{formatCoverage(source.verifiedObjects, source.totalObjects)}
				<small>{formatInteger(source.activeObjects)} checking now</small>
			</td>
			<td>{formatInteger(source.failedObjects)}</td>
		</tr>
	);
}

function ArchiveObjectQueuePanel({
	summary
}: {
	readonly summary: PublicHistoryArchiveObjectSummary;
}): React.JSX.Element {
	return (
		<section className="panel detail-panel archive-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive evidence checks</h2>
					<span className="muted-inline">
						Updated {formatDateTime(summary.generatedAt)}
					</span>
				</div>
				<StatusPill
					status={getObjectQueueStatus(summary)}
					text={formatObjectQueuePill(summary)}
				/>
			</div>
			<p className="muted-copy">
				Counts are per archive source and file identity. Shared bucket payloads
				are deduplicated by hash, but each archive source still needs its own
				evidence row.
			</p>
			<div className="responsive-table archive-summary-table-wrap">
				<table className="archive-summary-table">
					<thead>
						<tr>
							<th>Archive sources</th>
							<th>Checking now</th>
							<th>Verified evidence</th>
							<th>Remote failures</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>{formatInteger(getSourceCount(summary))}</td>
							<td>{formatInteger(summary.activeObjects)}</td>
							<td>{formatInteger(summary.verifiedObjects)}</td>
							<td>{formatInteger(summary.failedObjects)}</td>
						</tr>
					</tbody>
				</table>
			</div>
			<details className="metadata-document">
				<summary>
					<span>Scheduler backlog</span>
					<span className="muted-inline">
						{formatInteger(summary.pendingObjects)} queued evidence checks
					</span>
				</summary>
				<p className="muted-copy">
					This is the scanner work queue across all archive sources. It is not
					the number of unique bucket payloads stored locally and it is not a
					public service outage by itself.
				</p>
				<div className="responsive-table">
					<table className="archive-summary-table">
						<thead>
							<tr>
								<th>Discovered checks</th>
								<th>Verified</th>
								<th>Queued</th>
								<th>Checking now</th>
								<th>Remote failures</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>{formatInteger(summary.totalObjects)}</td>
								<td>{formatInteger(summary.verifiedObjects)}</td>
								<td>{formatInteger(summary.pendingObjects)}</td>
								<td>{formatInteger(summary.activeObjects)}</td>
								<td>{formatInteger(summary.failedObjects)}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</details>
			<ObjectTypeDetails objectTypes={summary.objectTypes} />
		</section>
	);
}

function ObjectTypeDetails({
	objectTypes
}: {
	readonly objectTypes: readonly PublicHistoryArchiveObjectTypeSummary[];
}): React.JSX.Element | null {
	if (objectTypes.length === 0) return null;

	return (
		<details className="metadata-document">
			<summary>
				<span>File-check breakdown</span>
				<span className="muted-inline">
					{formatInteger(objectTypes.length)} groups
				</span>
			</summary>
			<p className="muted-copy">
				These rows are queue evidence by archive file group. They are not
				decoded transaction, operation, or ledger entity counts.
			</p>
			<div className="responsive-table">
				<table className="archive-object-type-table">
					<thead>
						<tr>
							<th>File group</th>
							<th>Tracked</th>
							<th>Verified</th>
							<th>Waiting</th>
							<th>Failed</th>
							<th>Active checks</th>
						</tr>
					</thead>
					<tbody>
						{objectTypes.map((entry) => (
							<tr key={entry.objectType}>
								<td>{formatArchiveObjectTypeGroupLabel(entry.objectType)}</td>
								<td>{formatInteger(entry.totalObjects)}</td>
								<td>
									{formatCoverage(entry.verifiedObjects, entry.totalObjects)}
								</td>
								<td>{formatInteger(entry.pendingObjects)}</td>
								<td>{formatInteger(entry.failedObjects)}</td>
								<td>{formatInteger(entry.activeObjects)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</details>
	);
}

function CheckpointProofPanel({
	summary
}: {
	readonly summary: PublicHistoryArchiveObjectSummary;
}): React.JSX.Element {
	const checkpoints = summary.checkpoints;

	return (
		<section className="panel detail-panel archive-panel">
			<div className="panel-heading">
				<div>
					<h2>Checkpoint proof</h2>
					<span className="muted-inline">
						Updated {formatDateTime(summary.generatedAt)}
					</span>
				</div>
				<StatusPill
					status={getCheckpointProofStatus(summary)}
					text={formatCheckpointProofStatus(summary)}
				/>
			</div>
			<div className="responsive-table archive-summary-table-wrap">
				<table className="archive-checkpoint-proof-table">
					<thead>
						<tr>
							<th>Object complete</th>
							<th>Files agree</th>
							<th>Failed</th>
							<th>Waiting</th>
							<th>Not checked yet</th>
							<th>Sources with state</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								{formatInteger(checkpoints.objectCompleteArchiveCheckpoints)}
							</td>
							<td>
								{formatInteger(
									checkpoints.categoryConsistentArchiveCheckpoints
								)}
							</td>
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
							<td>{formatInteger(checkpoints.archiveRootsWithState)}</td>
						</tr>
					</tbody>
				</table>
			</div>
			<p className="muted-copy">
				Checkpoint proof checks whether one archive source has the expected
				history, ledger, transaction, result, SCP, and bucket files for a
				64-ledger checkpoint, then whether those files agree by hash. It is a
				file-consistency proof, not a decoded transaction count.
			</p>
		</section>
	);
}

function ArchiveSourceCoverageDetails({
	latestCheckpoint,
	oldestCheckpoint,
	summary
}: {
	readonly latestCheckpoint: number | null;
	readonly oldestCheckpoint: number | null;
	readonly summary: PublicHistoryArchiveObjectSummary;
}): React.JSX.Element {
	const checkpoints = summary.checkpoints;

	return (
		<details className="metadata-document archive-checkpoint-discovery">
			<summary>
				<span>Full-history discovery detail</span>
				<span className="muted-inline">
					{formatInteger(checkpoints.totalArchiveCheckpoints)} checkpoint rows
					discovered
				</span>
			</summary>
			<p className="muted-copy">
				Full coverage means every captured archive source has checkpoint rows
				from genesis through its latest published checkpoint. This is a scanner
				discovery target, not a production outage indicator.
			</p>
			<div className="responsive-table">
				<table className="archive-summary-table">
					<thead>
						<tr>
							<th>Sources</th>
							<th>Discovered source roots</th>
							<th>Oldest discovered checkpoint</th>
							<th>Latest discovered checkpoint</th>
							<th>Expected</th>
							<th>Missing</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>{formatInteger(checkpoints.archiveRootsWithState)}</td>
							<td>
								{formatInteger(checkpoints.discoveryCompleteArchiveRoots)}
							</td>
							<td>{formatLedger(oldestCheckpoint)}</td>
							<td>{formatLedger(latestCheckpoint)}</td>
							<td>{formatInteger(checkpoints.expectedArchiveCheckpoints)}</td>
							<td>{formatInteger(checkpoints.missingArchiveCheckpoints)}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</details>
	);
}

function getArchiveRootStatus(
	summary: PublicHistoryArchiveObjectSummary
): PublicStatusLevel {
	const checkpoints = summary.checkpoints;
	if (checkpoints.archiveRootsWithState === 0) return 'unavailable';
	return 'ok';
}

function getObjectQueueStatus(
	summary: PublicHistoryArchiveObjectSummary
): PublicStatusLevel {
	if (summary.totalObjects === 0) return 'unavailable';
	return 'ok';
}

function getCheckpointProofStatus(
	summary: PublicHistoryArchiveObjectSummary
): PublicStatusLevel {
	const checkpoints = summary.checkpoints;
	if (checkpoints.expectedArchiveCheckpoints === 0) return 'unavailable';
	return 'ok';
}

function formatArchiveRootStatus(
	summary: PublicHistoryArchiveObjectSummary
): string {
	const checkpoints = summary.checkpoints;
	const sourceCount = getSourceCount(summary);
	if (sourceCount === 0) return 'no sources captured';
	return (
		formatInteger(checkpoints.archiveRootsWithState) +
		' / ' +
		formatInteger(sourceCount) +
		' state files captured'
	);
}

function formatCheckpointProofStatus(
	summary: PublicHistoryArchiveObjectSummary
): string {
	const checkpoints = summary.checkpoints;
	if (checkpoints.categoryConsistencyFailedCheckpoints > 0) {
		return `${formatInteger(checkpoints.categoryConsistencyFailedCheckpoints)} failed`;
	}
	if (checkpoints.categoryConsistentArchiveCheckpoints > 0) {
		return `${formatInteger(checkpoints.categoryConsistentArchiveCheckpoints)} consistent`;
	}
	return 'not checked yet';
}

function formatObjectQueuePill(
	summary: PublicHistoryArchiveObjectSummary
): string {
	if (summary.activeObjects > 0) {
		return formatInteger(summary.activeObjects) + ' checking now';
	}
	return formatCoverage(summary.verifiedObjects, summary.totalObjects);
}

function formatCoverage(verified: number, total: number): string {
	if (total <= 0) return '0 / 0 verified';
	return `${formatInteger(verified)} / ${formatInteger(total)} verified (${formatPercent((verified / total) * 100)})`;
}

function formatLedger(value: number | null): string {
	return value === null ? 'not recorded' : formatInteger(value);
}

function formatArchiveSource(value: string): string {
	try {
		const url = new URL(value);
		const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
		return `${url.host}${path}`;
	} catch {
		return value;
	}
}

function getSourceCount(summary: PublicHistoryArchiveObjectSummary): number {
	return summary.sources.length > 0
		? summary.sources.length
		: summary.checkpoints.archiveRootsWithState;
}

function formatHistoryArchiveState(
	status: ArchiveSourceSummary['stateStatus']
): string {
	if (status === 'available') return 'captured';
	if (status === 'invalid') return 'invalid';
	return 'unreachable';
}

function formatRootObjectStatus(
	status: ArchiveSourceSummary['rootObjectStatus']
): string {
	return status === null
		? 'not queued'
		: {
				failed: 'failed',
				pending: 'waiting',
				scanning: 'checking',
				verified: 'verified'
			}[status];
}

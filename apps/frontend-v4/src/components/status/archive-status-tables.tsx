import type {
	PublicHistoryArchiveObjectQueue,
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
	readonly archiveObjects: PublicHistoryArchiveObjectQueue;
	readonly archiveObjectsAvailable: boolean;
	readonly summary: PublicHistoryArchiveObjectSummary;
}

export function StatusArchiveEvidenceTables({
	archiveObjects,
	archiveObjectsAvailable,
	summary
}: StatusArchiveEvidenceTablesProps): React.JSX.Element {
	return (
		<>
			<ArchiveRootPanel summary={summary} />
			<ArchiveObjectQueuePanel
				archiveObjects={archiveObjects}
				archiveObjectsAvailable={archiveObjectsAvailable}
				summary={summary}
			/>
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

	return (
		<section className="panel detail-panel archive-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive roots</h2>
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
							<th>Roots with state</th>
							<th>Discovery complete</th>
							<th>Expected checkpoints</th>
							<th>Missing checkpoints</th>
							<th>Oldest checkpoint</th>
							<th>Latest checkpoint</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>{formatInteger(checkpoints.archiveRootsWithState)}</td>
							<td>
								{formatInteger(checkpoints.discoveryCompleteArchiveRoots)} /{' '}
								{formatInteger(checkpoints.archiveRootsWithState)}
							</td>
							<td>{formatInteger(checkpoints.expectedArchiveCheckpoints)}</td>
							<td>{formatInteger(checkpoints.missingArchiveCheckpoints)}</td>
							<td>{formatLedger(checkpoints.oldestCheckpointLedger)}</td>
							<td>{formatLedger(checkpoints.latestCheckpointLedger)}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>
	);
}

function ArchiveObjectQueuePanel({
	archiveObjects,
	archiveObjectsAvailable,
	summary
}: {
	readonly archiveObjects: PublicHistoryArchiveObjectQueue;
	readonly archiveObjectsAvailable: boolean;
	readonly summary: PublicHistoryArchiveObjectSummary;
}): React.JSX.Element {
	return (
		<section className="panel detail-panel archive-panel">
			<div className="panel-heading">
				<div>
					<h2>Object queue</h2>
					<span className="muted-inline">
						Updated {formatDateTime(summary.generatedAt)}
					</span>
				</div>
				<StatusPill
					status={getObjectQueueStatus(summary)}
					text={formatCoverage(summary.verifiedObjects, summary.totalObjects)}
				/>
			</div>
			<div className="responsive-table archive-summary-table-wrap">
				<table className="archive-summary-table">
					<thead>
						<tr>
							<th>Tracked</th>
							<th>Verified</th>
							<th>Queued</th>
							<th>Failed</th>
							<th>Active checks</th>
							<th>Recent sample</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>{formatInteger(summary.totalObjects)}</td>
							<td>
								{formatCoverage(summary.verifiedObjects, summary.totalObjects)}
							</td>
							<td>{formatInteger(summary.pendingObjects)}</td>
							<td>{formatInteger(summary.failedObjects)}</td>
							<td>{formatInteger(summary.activeObjects)}</td>
							<td>
								{archiveObjectsAvailable
									? formatInteger(archiveObjects.objects.length)
									: 'unavailable'}
							</td>
						</tr>
					</tbody>
				</table>
			</div>
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
				<span>File-group queue counts</span>
				<span className="muted-inline">
					{formatInteger(objectTypes.length)} groups
				</span>
			</summary>
			<div className="responsive-table">
				<table className="archive-object-type-table">
					<thead>
						<tr>
							<th>File group</th>
							<th>Tracked</th>
							<th>Verified</th>
							<th>Queued</th>
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
							<th>Category consistent</th>
							<th>Failed</th>
							<th>Pending</th>
							<th>Not checked yet</th>
							<th>Expected</th>
							<th>Missing</th>
							<th>Roots discovered</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								{formatInteger(
									checkpoints.objectCompleteArchiveCheckpoints
								)}
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
							<td>{formatInteger(checkpoints.expectedArchiveCheckpoints)}</td>
							<td>{formatInteger(checkpoints.missingArchiveCheckpoints)}</td>
							<td>
								{formatInteger(checkpoints.discoveryCompleteArchiveRoots)} /{' '}
								{formatInteger(checkpoints.archiveRootsWithState)}
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>
	);
}

function getArchiveRootStatus(
	summary: PublicHistoryArchiveObjectSummary
): PublicStatusLevel {
	const checkpoints = summary.checkpoints;
	if (checkpoints.archiveRootsWithState === 0) return 'degraded';
	if (checkpoints.missingArchiveCheckpoints > 0) return 'degraded';
	return 'ok';
}

function getObjectQueueStatus(
	summary: PublicHistoryArchiveObjectSummary
): PublicStatusLevel {
	if (summary.failedObjects > 0 || summary.totalObjects === 0) return 'degraded';
	return 'ok';
}

function getCheckpointProofStatus(
	summary: PublicHistoryArchiveObjectSummary
): PublicStatusLevel {
	const checkpoints = summary.checkpoints;
	if (
		checkpoints.categoryConsistencyFailedCheckpoints > 0 ||
		checkpoints.missingArchiveCheckpoints > 0
	) {
		return 'degraded';
	}
	if (
		checkpoints.expectedArchiveCheckpoints === 0 ||
		checkpoints.categoryConsistencyPendingCheckpoints > 0 ||
		checkpoints.categoryConsistencyNotEvaluatedCheckpoints > 0
	) {
		return 'degraded';
	}
	return 'ok';
}

function formatArchiveRootStatus(
	summary: PublicHistoryArchiveObjectSummary
): string {
	const checkpoints = summary.checkpoints;
	if (checkpoints.archiveRootsWithState === 0) return 'no roots captured';
	return (
		formatInteger(checkpoints.discoveryCompleteArchiveRoots) +
		' / ' +
		formatInteger(checkpoints.archiveRootsWithState) +
		' complete'
	);
}

function formatCheckpointProofStatus(
	summary: PublicHistoryArchiveObjectSummary
): string {
	const checkpoints = summary.checkpoints;
	if (checkpoints.categoryConsistencyFailedCheckpoints > 0) {
		return (
			formatInteger(checkpoints.categoryConsistencyFailedCheckpoints) +
			' failed'
		);
	}
	if (checkpoints.categoryConsistentArchiveCheckpoints > 0) {
		return (
			formatInteger(checkpoints.categoryConsistentArchiveCheckpoints) +
			' consistent'
		);
	}
	return 'not checked yet';
}

function formatCoverage(verified: number, total: number): string {
	if (total <= 0) return '0 / 0 verified';
	return (
		formatInteger(verified) +
		' / ' +
		formatInteger(total) +
		' verified (' +
		formatPercent((verified / total) * 100) +
		')'
	);
}

function formatLedger(value: number | null): string {
	return value === null ? 'not recorded' : formatInteger(value);
}

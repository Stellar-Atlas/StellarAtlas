import type {
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveObjectTypeSummary
} from '@api/types';
import { StatusPill } from '@components/status/status-ui';
import { formatArchiveObjectTypeGroupLabel } from '@domain/history-archive';
import { checkpointProofIsComplete } from '@domain/history-archive-proof';
import {
	formatDateTime,
	formatInteger,
	formatPercent
} from '@format/formatters';

interface HistoryArchiveObjectCoverageProps {
	readonly framed?: boolean;
	readonly proofOpen?: boolean;
	readonly summary: PublicHistoryArchiveObjectSummary;
	readonly title?: string;
	readonly typeDetailsOpen?: boolean;
}

export function HistoryArchiveObjectCoverage({
	framed = true,
	proofOpen = false,
	summary,
	title = 'Archive evidence checks',
	typeDetailsOpen = false
}: HistoryArchiveObjectCoverageProps): React.JSX.Element {
	const coverageText = formatCoverage(
		summary.verifiedObjects,
		summary.totalObjects
	);
	const proofComplete = checkpointProofIsComplete(summary);
	const content = (
		<>
			<div className="panel-heading">
				<div>
					<h2>{title}</h2>
					<span className="muted-inline">
						Updated {formatDateTime(summary.generatedAt)}
					</span>
				</div>
				<StatusPill
					status={
						summary.failedObjects > 0 ||
						summary.totalObjects === 0 ||
						!proofComplete
							? 'degraded'
							: 'ok'
					}
					text={proofComplete ? coverageText : formatCheckpointProofHeadline(summary)}
				/>
			</div>
			<CoverageSummary summary={summary} />
			<CheckpointProofSummary open={proofOpen} summary={summary} />
			<ObjectTypeTable
				objectTypes={summary.objectTypes}
				open={typeDetailsOpen}
			/>
		</>
	);

	if (!framed) {
		return <div className="archive-object-coverage">{content}</div>;
	}

	return (
		<section className="panel detail-panel archive-panel">{content}</section>
	);
}

function CoverageSummary({
	summary
}: {
	readonly summary: PublicHistoryArchiveObjectSummary;
}): React.JSX.Element {
	const buckets = summary.buckets;
	const bucketCoverage = formatCoverage(
		buckets.verifiedBucketObjects,
		buckets.totalBucketObjects
	);

	return (
		<div className="responsive-table archive-summary-table-wrap">
			<table className="archive-summary-table">
				<thead>
					<tr>
						<th>Archive-source files checked</th>
						<th>Bucket references verified</th>
						<th>Unique bucket files</th>
						<th>Checking now</th>
						<th>Waiting</th>
						<th>Evidence failures</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							{formatCoverage(summary.verifiedObjects, summary.totalObjects)}
						</td>
						<td>{bucketCoverage}</td>
						<td>{formatInteger(buckets.uniqueBucketHashes)}</td>
						<td>{formatInteger(summary.activeObjects)}</td>
						<td>{formatInteger(summary.pendingObjects)}</td>
						<td>{formatInteger(summary.failedObjects)}</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}

function CheckpointProofSummary({
	open,
	summary
}: {
	readonly open: boolean;
	readonly summary: PublicHistoryArchiveObjectSummary;
}): React.JSX.Element {
	const checkpoints = summary.checkpoints;

	return (
		<details className="metadata-document archive-checkpoint-proof" open={open}>
			<summary>
				<span>Checkpoint proof</span>
				<span className="muted-inline">
					{formatCheckpointProofHeadline(summary)}
				</span>
			</summary>
			<p className="muted-copy">
				Archive-source file checks verify one object at one archive source.
				Checkpoint proof verifies that the history, ledger, transaction,
				result, and bucket-list facts agree for the same checkpoint.
			</p>
			<div className="responsive-table">
				<table className="archive-checkpoint-proof-table">
					<thead>
						<tr>
							<th>Complete file sets</th>
							<th>File sets agree</th>
							<th>Failed</th>
							<th>Waiting</th>
							<th>Not checked yet</th>
							<th>Expected</th>
							<th>Missing</th>
							<th>Sources fully discovered</th>
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
		</details>
	);
}

function ObjectTypeTable({
	objectTypes,
	open
}: {
	readonly objectTypes: readonly PublicHistoryArchiveObjectTypeSummary[];
	readonly open: boolean;
}): React.JSX.Element | null {
	if (objectTypes.length === 0) return null;

	return (
		<details className="metadata-document" open={open}>
			<summary>
				<span>Archive file-check details</span>
				<span className="muted-inline">
					{formatInteger(objectTypes.length)} file groups
				</span>
			</summary>
			<p className="muted-copy">
				These are counts of archive-source file checks, not decoded blockchain
				entities. A transaction archive file can contain transaction data for
				many ledgers; this is not a transaction count.
			</p>
			<div className="responsive-table">
				<table className="archive-object-type-table">
					<thead>
						<tr>
							<th>File group</th>
							<th>Tracked</th>
							<th>Verified</th>
							<th>Queued</th>
							<th>Evidence failures</th>
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
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</details>
	);
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

function formatCheckpointProofHeadline(
	summary: PublicHistoryArchiveObjectSummary
): string {
	const checkpoints = summary.checkpoints;
	if (checkpoints.categoryConsistentArchiveCheckpoints > 0) {
		return (
			formatInteger(checkpoints.categoryConsistentArchiveCheckpoints) +
			' checkpoint file sets agree'
		);
	}
	if (checkpoints.categoryConsistencyNotEvaluatedCheckpoints > 0) {
		return (
			formatInteger(checkpoints.categoryConsistencyNotEvaluatedCheckpoints) +
			' not checked yet'
		);
	}
	return 'not checked yet';
}

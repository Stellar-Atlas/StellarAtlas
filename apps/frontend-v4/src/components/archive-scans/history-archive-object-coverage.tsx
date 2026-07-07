import type {
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveObjectTypeSummary
} from '@api/types';
import { StatusPill } from '@components/status/status-ui';
import { formatArchiveObjectTypeGroupLabel } from '@domain/history-archive';
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
	title = 'Archive file coverage',
	typeDetailsOpen = false
}: HistoryArchiveObjectCoverageProps): React.JSX.Element {
	const coverageText = formatCoverage(
		summary.verifiedObjects,
		summary.totalObjects
	);
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
						summary.failedObjects > 0 || summary.totalObjects === 0
							? 'degraded'
							: 'ok'
					}
					text={coverageText}
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
						<th>File checks verified</th>
						<th>Bucket copies verified</th>
						<th>Unique bucket payloads</th>
						<th>Checking now</th>
						<th>Waiting</th>
						<th>Failures</th>
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
				<span>Chain consistency proof</span>
				<span className="muted-inline">
					{formatCheckpointProofHeadline(summary)}
				</span>
			</summary>
			<p className="muted-copy">
				File coverage means individual archive files were fetched and checked.
				Chain consistency proof is stricter: the checkpoint history file,
				ledger headers, transaction files, result files, and bucket list all
				have to agree.
			</p>
			<div className="responsive-table">
				<table className="archive-checkpoint-proof-table">
					<thead>
						<tr>
							<th>Files present</th>
							<th>Consistent</th>
							<th>Failed</th>
							<th>Waiting</th>
							<th>Not checked yet</th>
							<th>Expected</th>
							<th>Missing</th>
							<th>Roots complete</th>
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
				<span>Archive file type details</span>
				<span className="muted-inline">
					{formatInteger(objectTypes.length)} file groups
				</span>
			</summary>
			<p className="muted-copy">
				These are counts of archive-root file checks. A transaction archive
				file can contain transaction data for many ledgers; this is not a
				transaction count.
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
			' category-consistent'
		);
	}
	if (checkpoints.categoryConsistencyNotEvaluatedCheckpoints > 0) {
		return (
			formatInteger(checkpoints.categoryConsistencyNotEvaluatedCheckpoints) +
			' not evaluated'
		);
	}
	return 'proof not evaluated';
}

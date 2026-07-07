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
	readonly summary: PublicHistoryArchiveObjectSummary;
	readonly title?: string;
}

export function HistoryArchiveObjectCoverage({
	framed = true,
	summary,
	title = 'Archive object coverage'
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
					status={summary.totalObjects > 0 ? 'ok' : 'degraded'}
					text={coverageText}
				/>
			</div>
			<CoverageSummary summary={summary} />
			<ObjectTypeTable objectTypes={summary.objectTypes} />
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
						<th>Object checks</th>
						<th>Bucket references</th>
						<th>Unique bucket hashes</th>
						<th>Active checks</th>
						<th>Queued checks</th>
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

function ObjectTypeTable({
	objectTypes
}: {
	readonly objectTypes: readonly PublicHistoryArchiveObjectTypeSummary[];
}): React.JSX.Element {
	if (objectTypes.length === 0) {
		return (
			<p className="muted-copy">No archive object checks are stored yet.</p>
		);
	}

	return (
		<details className="metadata-document">
			<summary>
				<span>Object check type details</span>
				<span className="muted-inline">
					{formatInteger(objectTypes.length)} check groups
				</span>
			</summary>
			<p className="muted-copy">
				These are archive object checks. Bucket payloads are content-addressed
				by hash; checkpoint and category checks cover the history, ledger,
				transaction, result, and SCP objects for a checkpoint.
			</p>
			<div className="responsive-table">
				<table className="archive-object-type-table">
					<thead>
						<tr>
							<th>Check group</th>
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

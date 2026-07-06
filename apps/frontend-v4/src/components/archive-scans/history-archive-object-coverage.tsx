import type {
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveObjectTypeSummary
} from '@api/types';
import { StatusPill } from '@components/status/status-ui';
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
	title = 'Archive file coverage'
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
		<dl className="details compact-details">
			<div>
				<dt>Archive files verified</dt>
				<dd>{formatCoverage(summary.verifiedObjects, summary.totalObjects)}</dd>
			</div>
			<div>
				<dt>Bucket copies verified</dt>
				<dd>{bucketCoverage}</dd>
			</div>
			<div>
				<dt>Unique bucket hashes</dt>
				<dd>{formatInteger(buckets.uniqueBucketHashes)}</dd>
			</div>
			<div>
				<dt>Active file checks</dt>
				<dd>{formatInteger(summary.activeObjects)}</dd>
			</div>
			<div>
				<dt>Queued file checks</dt>
				<dd>{formatInteger(summary.pendingObjects)}</dd>
			</div>
			<div>
				<dt>Failed archive evidence</dt>
				<dd>{formatInteger(summary.failedObjects)}</dd>
			</div>
		</dl>
	);
}

function ObjectTypeTable({
	objectTypes
}: {
	readonly objectTypes: readonly PublicHistoryArchiveObjectTypeSummary[];
}): React.JSX.Element {
	if (objectTypes.length === 0) {
		return <p className="muted-copy">No archive file rows are stored yet.</p>;
	}

	return (
		<details className="metadata-document">
			<summary>
				<span>Archive file type details</span>
				<span className="muted-inline">
					{formatInteger(objectTypes.length)} file groups
				</span>
			</summary>
			<p className="muted-copy">
				These are archive files, not individual ledger transactions or operations.
			</p>
			<div className="responsive-table">
				<table className="archive-object-type-table">
					<thead>
						<tr>
							<th>File group</th>
							<th>Tracked</th>
							<th>Verified</th>
							<th>Queued</th>
							<th>Failed</th>
						</tr>
					</thead>
					<tbody>
						{objectTypes.map((entry) => (
							<tr key={entry.objectType}>
								<td>{formatObjectType(entry.objectType)}</td>
								<td>{formatInteger(entry.totalObjects)}</td>
								<td>{formatCoverage(entry.verifiedObjects, entry.totalObjects)}</td>
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

function formatObjectType(
	type: PublicHistoryArchiveObjectTypeSummary['objectType']
): string {
	if (type === 'history-archive-state') return 'history archive state files';
	if (type === 'checkpoint-state') return 'checkpoint history files';
	if (type === 'ledger') return 'ledger files';
	if (type === 'transactions') return 'transaction archive files';
	if (type === 'results') return 'result archive files';
	if (type === 'scp') return 'SCP archive files';
	if (type === 'bucket') return 'bucket files';
	return type;
}

import type {
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveObjectTypeSummary
} from '@api/types';
import { StatusPill } from '@components/status/status-ui';
import { formatDateTime, formatInteger } from '@format/formatters';

interface HistoryArchiveObjectCoverageProps {
	readonly framed?: boolean;
	readonly summary: PublicHistoryArchiveObjectSummary;
	readonly title?: string;
}

export function HistoryArchiveObjectCoverage({
	framed = true,
	summary,
	title = 'History archive object coverage'
}: HistoryArchiveObjectCoverageProps): React.JSX.Element {
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
					text={`${formatInteger(summary.verifiedObjects)} verified`}
				/>
			</div>
			<dl className="details compact-details">
				<div>
					<dt>Total objects</dt>
					<dd>{formatInteger(summary.totalObjects)}</dd>
				</div>
				<div>
					<dt>Scanning</dt>
					<dd>{formatInteger(summary.activeObjects)}</dd>
				</div>
				<div>
					<dt>Pending</dt>
					<dd>{formatInteger(summary.pendingObjects)}</dd>
				</div>
				<div>
					<dt>Failed evidence</dt>
					<dd>{formatInteger(summary.failedObjects)}</dd>
				</div>
			</dl>
			<CoverageGrid summary={summary} />
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

function CoverageGrid({
	summary
}: {
	readonly summary: PublicHistoryArchiveObjectSummary;
}): React.JSX.Element {
	const checkpoints = summary.checkpoints;
	const buckets = summary.buckets;

	return (
		<div className="archive-coverage-grid">
			<div>
				<strong>{formatInteger(checkpoints.completeArchiveCheckpoints)}</strong>
				<span>complete checkpoints</span>
			</div>
			<div>
				<strong>{formatInteger(checkpoints.expectedArchiveCheckpoints)}</strong>
				<span>expected checkpoints</span>
			</div>
			<div>
				<strong>{formatInteger(checkpoints.missingArchiveCheckpoints)}</strong>
				<span>missing checkpoints</span>
			</div>
			<div>
				<strong>{formatInteger(checkpoints.partialArchiveCheckpoints)}</strong>
				<span>partial checkpoints</span>
			</div>
			<div>
				<strong>{formatInteger(checkpoints.failedArchiveCheckpoints)}</strong>
				<span>failed checkpoints</span>
			</div>
			<div>
				<strong>{formatInteger(buckets.totalBucketObjects)}</strong>
				<span>bucket objects</span>
			</div>
			<div>
				<strong>{formatInteger(buckets.uniqueBucketHashes)}</strong>
				<span>unique bucket hashes</span>
			</div>
			<div>
				<strong>{formatCheckpointRange(summary)}</strong>
				<span>checkpoint range</span>
			</div>
			<div>
				<strong>
					{formatInteger(checkpoints.discoveryCompleteArchiveRoots)} /{' '}
					{formatInteger(checkpoints.archiveRootsWithState)}
				</strong>
				<span>roots fully discovered</span>
			</div>
		</div>
	);
}

function ObjectTypeTable({
	objectTypes
}: {
	readonly objectTypes: readonly PublicHistoryArchiveObjectTypeSummary[];
}): React.JSX.Element {
	if (objectTypes.length === 0) {
		return <p className="muted-copy">No archive object rows are stored yet.</p>;
	}

	return (
		<div className="table archive-object-type-table">
			{objectTypes.map((entry) => (
				<div className="row compact" key={entry.objectType}>
					<div>
						<strong>{formatObjectType(entry.objectType)}</strong>
						<small>{formatInteger(entry.totalObjects)} stored objects</small>
					</div>
					<div className="metric">
						<strong>{formatInteger(entry.verifiedObjects)} verified</strong>
						<small>
							{formatInteger(entry.pendingObjects)} pending /{' '}
							{formatInteger(entry.failedObjects)} failed
						</small>
					</div>
				</div>
			))}
		</div>
	);
}

function formatCheckpointRange(
	summary: PublicHistoryArchiveObjectSummary
): string {
	const { latestCheckpointLedger, oldestCheckpointLedger } =
		summary.checkpoints;
	if (oldestCheckpointLedger === null || latestCheckpointLedger === null) {
		return 'none';
	}
	if (oldestCheckpointLedger === latestCheckpointLedger) {
		return formatInteger(latestCheckpointLedger);
	}
	return `${formatInteger(oldestCheckpointLedger)} - ${formatInteger(
		latestCheckpointLedger
	)}`;
}

function formatObjectType(
	type: PublicHistoryArchiveObjectTypeSummary['objectType']
): string {
	if (type === 'history-archive-state') return 'history archive state';
	if (type === 'checkpoint-state') return 'checkpoint state';
	return type;
}

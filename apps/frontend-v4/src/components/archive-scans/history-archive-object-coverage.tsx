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
			<AdvancedCheckpointDiscovery summary={summary} />
			<HostThrottleTable hostThrottles={summary.hostThrottles} />
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
			<div>
				<dt>Discovery range</dt>
				<dd>{formatCheckpointRange(summary)}</dd>
			</div>
			<div>
				<dt>Archive roots discovered</dt>
				<dd>
					{formatInteger(summary.checkpoints.discoveryCompleteArchiveRoots)} /{' '}
					{formatInteger(summary.checkpoints.archiveRootsWithState)} complete
				</dd>
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
		<div className="table archive-object-type-table">
			{objectTypes.map((entry) => (
				<div className="row compact" key={entry.objectType}>
					<div>
						<strong>{formatObjectType(entry.objectType)}</strong>
						<small>{formatInteger(entry.totalObjects)} tracked files</small>
					</div>
					<div className="metric">
						<strong>
							{formatCoverage(entry.verifiedObjects, entry.totalObjects)}
						</strong>
						<small>
							{formatInteger(entry.pendingObjects)} queued /{' '}
							{formatInteger(entry.failedObjects)} failed
						</small>
					</div>
				</div>
			))}
		</div>
	);
}

function AdvancedCheckpointDiscovery({
	summary
}: {
	readonly summary: PublicHistoryArchiveObjectSummary;
}): React.JSX.Element {
	const checkpoints = summary.checkpoints;

	return (
		<details className="metadata-document">
			<summary>
				<span>Advanced checkpoint discovery</span>
				<span className="muted-inline">
					{formatInteger(checkpoints.objectCompleteArchiveCheckpoints)} complete
					/ {formatInteger(checkpoints.expectedArchiveCheckpoints)} expected
				</span>
			</summary>
			<dl className="details compact-details">
				<div>
					<dt>Complete checkpoints</dt>
					<dd>{formatInteger(checkpoints.objectCompleteArchiveCheckpoints)}</dd>
				</div>
				<div>
					<dt>Category files consistent</dt>
					<dd>
						{formatInteger(checkpoints.categoryConsistentArchiveCheckpoints)}
					</dd>
				</div>
				<div>
					<dt>Waiting for consistency proof</dt>
					<dd>
						{formatInteger(
							checkpoints.categoryConsistencyNotEvaluatedCheckpoints
						)}
					</dd>
				</div>
				<div>
					<dt>Expected checkpoints</dt>
					<dd>{formatInteger(checkpoints.expectedArchiveCheckpoints)}</dd>
				</div>
				<div>
					<dt>Missing checkpoint state files</dt>
					<dd>{formatInteger(checkpoints.missingArchiveCheckpoints)}</dd>
				</div>
				<div>
					<dt>Incomplete checkpoints</dt>
					<dd>{formatInteger(checkpoints.partialArchiveCheckpoints)}</dd>
				</div>
				<div>
					<dt>Failed checkpoints</dt>
					<dd>{formatInteger(checkpoints.failedArchiveCheckpoints)}</dd>
				</div>
			</dl>
		</details>
	);
}

function HostThrottleTable({
	hostThrottles
}: {
	readonly hostThrottles: PublicHistoryArchiveObjectSummary['hostThrottles'];
}): React.JSX.Element | null {
	if (hostThrottles.length === 0) return null;

	return (
		<details className="metadata-document">
			<summary>
				<span>Temporary archive host backoff</span>
				<span className="muted-inline">
					{formatInteger(hostThrottles.length)} hosts paused
				</span>
			</summary>
			<p className="muted-copy">
				Backoff pauses retries for a specific archive host after repeated file
				fetch failures. It is not a StellarAtlas service outage.
			</p>
			<div className="table archive-host-throttle-table">
				{hostThrottles.map((throttle) => (
					<div className="row compact" key={throttle.hostIdentity}>
						<div>
							<strong>{throttle.hostIdentity}</strong>
							<small>
								{formatHostThrottleReason(throttle.failureClass)} /{' '}
								{throttle.evidenceClass}
							</small>
						</div>
						<div className="metric">
							<strong>
								Retry after {formatDateTime(throttle.blockedUntil)}
							</strong>
							<small>
								{formatInteger(throttle.consecutiveFailures)} failures /{' '}
								{formatHttpStatus(throttle.httpStatus)}
							</small>
						</div>
					</div>
				))}
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
	return (
		formatInteger(oldestCheckpointLedger) +
		' - ' +
		formatInteger(latestCheckpointLedger)
	);
}

function formatObjectType(
	type: PublicHistoryArchiveObjectTypeSummary['objectType']
): string {
	if (type === 'history-archive-state') return 'root state files';
	if (type === 'checkpoint-state') return 'checkpoint state files';
	if (type === 'ledger') return 'ledger files';
	if (type === 'transactions') return 'transaction category files';
	if (type === 'results') return 'result category files';
	if (type === 'scp') return 'SCP category files';
	if (type === 'bucket') return 'bucket files';
	return type;
}

function formatHostThrottleReason(
	value: PublicHistoryArchiveObjectSummary['hostThrottles'][number]['failureClass']
): string {
	if (value === 'not-found') return 'missing file';
	if (value === 'rate-limit') return 'rate limited';
	if (value === 'auth') return 'access denied';
	if (value === 'transport') return 'transport';
	if (value === 'timeout') return 'timeout';
	if (value === 'coordinator') return 'coordinator';
	if (value === 'worker') return 'worker';
	return value;
}

function formatHttpStatus(value: number | null): string {
	return value === null ? 'No HTTP response' : 'HTTP ' + value;
}

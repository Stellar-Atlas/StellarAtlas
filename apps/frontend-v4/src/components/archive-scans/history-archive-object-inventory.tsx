import type {
	PublicHistoryArchiveObject,
	PublicHistoryArchiveObjectQueue,
	PublicStatusLevel
} from '@api/types';
import { StatusPill } from '@components/status/status-ui';
import { formatDateTime, formatInteger } from '@format/formatters';

interface HistoryArchiveObjectInventoryProps {
	readonly framed?: boolean;
	readonly objects: PublicHistoryArchiveObjectQueue;
	readonly title?: string;
}

export function HistoryArchiveObjectInventory({
	framed = true,
	objects,
	title = 'History archive object inventory'
}: HistoryArchiveObjectInventoryProps): React.JSX.Element {
	const content = (
		<>
			<div className="panel-heading">
				<div>
					<h2>{title}</h2>
					<span className="muted-inline">
						Updated {formatDateTime(objects.generatedAt)}
					</span>
				</div>
				<StatusPill
					status={hasDelayedObject(objects) ? 'degraded' : 'ok'}
					text={`${formatInteger(objects.activeObjects)} active`}
				/>
			</div>
			<ObjectSummary objects={objects} />
			{objects.objects.length === 0 ? (
				<p className="muted-copy">
					No history archive object rows match the current filter.
				</p>
			) : (
				<div className="table archive-object-table">
					{objects.objects.map((object) => (
						<ObjectRow
							key={object.remoteId}
							generatedAt={objects.generatedAt}
							object={object}
						/>
					))}
				</div>
			)}
		</>
	);

	if (!framed) {
		return <div className="archive-object-inventory">{content}</div>;
	}

	return (
		<section className="panel detail-panel archive-panel">{content}</section>
	);
}

export function HistoryArchiveObjectSummary({
	objects
}: {
	readonly objects: PublicHistoryArchiveObjectQueue;
}): React.JSX.Element {
	return <ObjectSummary objects={objects} />;
}

function ObjectSummary({
	objects
}: {
	readonly objects: PublicHistoryArchiveObjectQueue;
}): React.JSX.Element {
	return (
		<dl className="details compact-details">
			<div>
				<dt>Scanning</dt>
				<dd>{formatInteger(objects.activeObjects)}</dd>
			</div>
			<div>
				<dt>Pending</dt>
				<dd>{formatInteger(objects.pendingObjects)}</dd>
			</div>
			<div>
				<dt>Verified</dt>
				<dd>{formatInteger(objects.verifiedObjects)}</dd>
			</div>
			<div>
				<dt>Failed</dt>
				<dd>{formatInteger(objects.failedObjects)}</dd>
			</div>
		</dl>
	);
}

function ObjectRow({
	generatedAt,
	object
}: {
	readonly generatedAt: string;
	readonly object: PublicHistoryArchiveObject;
}): React.JSX.Element {
	const objectStatus = getObjectDisplayStatus(object, generatedAt);

	return (
		<div className="row archive-object-row">
			<div className="archive-object-main">
				<div className="archive-object-title">
					<StatusPill
						status={mapObjectStatus(objectStatus)}
						text={formatObjectStatus(objectStatus)}
					/>
					<strong>{formatObjectType(object.objectType)}</strong>
					<span>{formatObjectLedger(object)}</span>
				</div>
				<small className="archive-object-source">
					Source: {formatArchiveSource(object.archiveUrl)}
				</small>
				<small className="archive-object-url">
					Object:{' '}
					<ArchiveObjectUrl object={object} />
				</small>
				{object.bucketHash ? (
					<small className="archive-object-hash">{object.bucketHash}</small>
				) : null}
				{object.error ? (
					<small className="archive-object-error">
						{object.error.type}: {sanitizeEvidenceText(object.error.message)}
					</small>
				) : null}
			</div>
			<div className="metric archive-object-metric">
				<strong>{object.workerStage ?? formatObjectStatus(objectStatus)}</strong>
				<small>{formatObjectWork(object)}</small>
			</div>
		</div>
	);
}

function ArchiveObjectUrl({
	object
}: {
	readonly object: PublicHistoryArchiveObject;
}): React.JSX.Element {
	if (isPublicHttpUrl(object.objectUrl)) {
		return (
			<a href={object.objectUrl} rel="noopener noreferrer" target="_blank">
				{object.objectKey}
			</a>
		);
	}

	return <>{object.objectKey}</>;
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

type ObjectDisplayStatus = PublicHistoryArchiveObject['status'] | 'delayed';

function getObjectDisplayStatus(
	object: PublicHistoryArchiveObject,
	generatedAt: string
): ObjectDisplayStatus {
	if (object.status !== 'scanning') return object.status;
	const generatedAtMs = Date.parse(generatedAt);
	const updatedAt = Date.parse(object.updatedAt);
	if (!Number.isFinite(updatedAt) || !Number.isFinite(generatedAtMs)) {
		return object.status;
	}
	return generatedAtMs - updatedAt > ARCHIVE_OBJECT_STALE_AGE_MS
		? 'delayed'
		: object.status;
}

function hasDelayedObject(objects: PublicHistoryArchiveObjectQueue): boolean {
	return objects.objects.some(
		(object) => getObjectDisplayStatus(object, objects.generatedAt) === 'delayed'
	);
}

function mapObjectStatus(status: ObjectDisplayStatus): PublicStatusLevel {
	if (status === 'failed' || status === 'delayed') return 'degraded';
	if (status === 'scanning') return 'ok';
	return 'ok';
}

function formatObjectStatus(status: ObjectDisplayStatus): string {
	if (status === 'delayed') return 'delayed';
	if (status === 'scanning') return 'scanning';
	if (status === 'verified') return 'verified';
	if (status === 'failed') return 'failed';
	return 'pending';
}

function formatObjectType(type: PublicHistoryArchiveObject['objectType']): string {
	if (type === 'history-archive-state') return 'history archive state';
	if (type === 'checkpoint-state') return 'checkpoint state';
	return type;
}

function formatObjectLedger(object: PublicHistoryArchiveObject): string {
	if (object.checkpointLedger === null) return '';
	return `checkpoint ${formatInteger(object.checkpointLedger)}`;
}

function formatObjectWork(object: PublicHistoryArchiveObject): string {
	const parts = [
		`${formatInteger(object.attempts)} attempts`,
		object.bytesDownloaded === null ? null : formatBytes(object.bytesDownloaded),
		object.claimedAt ? `claimed ${formatDateTime(object.claimedAt)}` : null,
		object.verifiedAt ? `verified ${formatDateTime(object.verifiedAt)}` : null,
		`updated ${formatDateTime(object.updatedAt)}`
	].filter((part): part is string => part !== null && part.length > 0);

	return parts.join(' / ');
}

function formatBytes(value: number | null): string {
	if (value === null) return 'bytes not reported';
	if (value < 1024) return `${formatInteger(value)} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let amount = value / 1024;
	for (const unit of units) {
		if (amount < 1024) return `${amount.toFixed(amount < 10 ? 1 : 0)} ${unit}`;
		amount /= 1024;
	}

	return `${amount.toFixed(1)} PB`;
}

function isPublicHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

const ARCHIVE_OBJECT_STALE_AGE_MS = 2 * 60 * 1000;

function sanitizeEvidenceText(value: string): string {
	return value
		.replace(
			/(["'])?\/home\/observe\/stellarbeat-data\/Observer\/history-bucket-cache(?:\/[A-Za-z0-9._-]+)*\1?/g,
			'[history bucket cache path]'
		)
		.replace(
			/(["'])?\/tmp\/stellaratlas-history-scanner-test-cache(?:\/[A-Za-z0-9._-]+)*\1?/g,
			'[history bucket cache path]'
		);
}

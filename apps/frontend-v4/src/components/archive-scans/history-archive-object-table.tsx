import Link from 'next/link';
import type {
	PublicHistoryArchiveBucketCrossCoverage,
	PublicHistoryArchiveObject,
	PublicStatusLevel
} from '@api/types';
import { StatusPill } from '@components/status/status-ui';
import { getArchiveScanDetailPath } from '@domain/archive-scan-routes';
import {
	formatArchiveObjectTypeLabel,
	formatArchiveObjectTypeRole,
	sanitizeArchiveEvidenceText
} from '@domain/history-archive';
import {
	formatDateTime,
	formatInteger,
	formatPercent
} from '@format/formatters';

interface ArchiveObjectTableProps {
	readonly coverageByBucketHash: ReadonlyMap<
		string,
		PublicHistoryArchiveBucketCrossCoverage
	>;
	readonly generatedAt: string;
	readonly objects: readonly PublicHistoryArchiveObject[];
}

export type ArchiveObjectDisplayStatus =
	PublicHistoryArchiveObject['status'] | 'delayed';

export function ArchiveObjectTable({
	coverageByBucketHash,
	generatedAt,
	objects
}: ArchiveObjectTableProps): React.JSX.Element {
	return (
		<div className="responsive-table">
			<table className="archive-object-table">
				<thead>
					<tr>
						<th>Status</th>
						<th>Archive file</th>
						<th>Archive root</th>
						<th>Path or hash</th>
						<th>Worker activity</th>
					</tr>
				</thead>
				<tbody>
					{objects.map((object) => (
						<ObjectRow
							bucketCoverage={
								object.bucketHash === null
									? null
									: (coverageByBucketHash.get(object.bucketHash) ?? null)
							}
							generatedAt={generatedAt}
							key={object.remoteId}
							object={object}
						/>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function getArchiveObjectDisplayStatus(
	object: PublicHistoryArchiveObject,
	generatedAt: string
): ArchiveObjectDisplayStatus {
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

export function isPriorityArchiveObject(
	object: PublicHistoryArchiveObject,
	generatedAt: string
): boolean {
	const status = getArchiveObjectDisplayStatus(object, generatedAt);
	return (
		status === 'failed' ||
		status === 'delayed' ||
		status === 'scanning' ||
		(object.objectType === 'history-archive-state' && status !== 'verified')
	);
}

export function prioritizeArchiveObjects(
	objects: readonly PublicHistoryArchiveObject[],
	generatedAt: string
): PublicHistoryArchiveObject[] {
	return [...objects].sort((left, right) => {
		const priority =
			getObjectPriority(left, generatedAt) -
			getObjectPriority(right, generatedAt);
		if (priority !== 0) return priority;
		const ledger = (left.checkpointLedger ?? 0) - (right.checkpointLedger ?? 0);
		if (ledger !== 0) return ledger;
		return left.objectKey.localeCompare(right.objectKey);
	});
}

function ObjectRow({
	bucketCoverage,
	generatedAt,
	object
}: {
	readonly bucketCoverage: PublicHistoryArchiveBucketCrossCoverage | null;
	readonly generatedAt: string;
	readonly object: PublicHistoryArchiveObject;
}): React.JSX.Element {
	const objectStatus = getArchiveObjectDisplayStatus(object, generatedAt);

	return (
		<tr>
			<td>
				<StatusPill
					status={mapObjectStatus(objectStatus)}
					text={formatObjectStatus(objectStatus)}
				/>
			</td>
			<td>
				<strong>{formatArchiveObjectTypeLabel(object.objectType)}</strong>
				<small>{formatObjectDescriptor(object)}</small>
			</td>
			<td>
				<Link href={getArchiveScanDetailPath(object.archiveUrl)}>
					{formatArchiveSource(object.archiveUrl)}
				</Link>
			</td>
			<td>
				<ArchiveObjectUrl object={object} />
				{object.bucketHash ? (
					<small className="archive-object-hash">{object.bucketHash}</small>
				) : null}
				{object.bucketHash ? (
					<BucketCoverageDrilldown
						bucketCoverage={bucketCoverage}
						bucketHash={object.bucketHash}
					/>
				) : null}
				{object.error ? (
					<small className="archive-object-error">
						{object.error.type}:{' '}
						{sanitizeArchiveEvidenceText(object.error.message)}
					</small>
				) : null}
			</td>
			<td>
				<strong>
					{object.workerStage ?? formatObjectStatus(objectStatus)}
				</strong>
				<small>{formatObjectWork(object)}</small>
			</td>
		</tr>
	);
}

function BucketCoverageDrilldown({
	bucketCoverage,
	bucketHash
}: {
	readonly bucketCoverage: PublicHistoryArchiveBucketCrossCoverage | null;
	readonly bucketHash: string;
}): React.JSX.Element | null {
	if (bucketCoverage === null) return null;

	return (
		<details className="archive-object-bucket-coverage">
			<summary>{formatBucketCoverageSummary(bucketCoverage)}</summary>
			<dl className="details compact-details">
				<div>
					<dt>Bucket hash</dt>
					<dd>{bucketHash.slice(0, 16)}...</dd>
				</div>
				<div>
					<dt>Generated</dt>
					<dd>{formatDateTime(bucketCoverage.generatedAt)}</dd>
				</div>
				<div>
					<dt>Archive roots</dt>
					<dd>{formatInteger(bucketCoverage.counts.archiveRoots)}</dd>
				</div>
			</dl>
			<BucketCoverageSamples bucketCoverage={bucketCoverage} />
		</details>
	);
}

function BucketCoverageSamples({
	bucketCoverage
}: {
	readonly bucketCoverage: PublicHistoryArchiveBucketCrossCoverage;
}): React.JSX.Element {
	const samples = [
		...bucketCoverage.failedCopies.slice(0, 2),
		...bucketCoverage.scanningCopies.slice(0, 2),
		...bucketCoverage.pendingCopies.slice(0, 2),
		...bucketCoverage.verifiedCopies.slice(0, 2)
	];

	if (samples.length === 0) {
		return (
			<p className="muted-copy">No archive-root references are recorded.</p>
		);
	}

	return (
		<div className="table archive-object-bucket-copy-table">
			{samples.map((copy) => (
				<div className="row compact" key={copy.remoteId}>
					<div>
						<strong>{formatArchiveSource(copy.archiveUrl)}</strong>
						<small>{copy.objectKey}</small>
					</div>
					<div className="metric">
						<strong>{copy.workerStage ?? copy.status}</strong>
						<small>{formatBucketCopyWork(copy)}</small>
					</div>
				</div>
			))}
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

function getObjectPriority(
	object: PublicHistoryArchiveObject,
	generatedAt: string
): number {
	const status = getArchiveObjectDisplayStatus(object, generatedAt);
	if (status === 'failed') return 0;
	if (status === 'delayed') return 1;
	if (status === 'scanning') return 2;
	if (object.objectType === 'history-archive-state' && status !== 'verified') {
		return 3;
	}
	if (status === 'pending') return 4;
	if (object.objectType === 'history-archive-state') return 5;
	if (object.objectType === 'bucket') return 6;
	return 7;
}

function mapObjectStatus(
	status: ArchiveObjectDisplayStatus
): PublicStatusLevel {
	if (status === 'failed' || status === 'delayed') return 'degraded';
	return 'ok';
}

function formatObjectStatus(status: ArchiveObjectDisplayStatus): string {
	if (status === 'delayed') return 'delayed';
	if (status === 'scanning') return 'scanning';
	if (status === 'verified') return 'verified';
	if (status === 'failed') return 'failed';
	return 'pending';
}

function formatObjectDescriptor(object: PublicHistoryArchiveObject): string {
	const role = formatArchiveObjectTypeRole(object.objectType);
	const ledger = formatObjectLedger(object);
	if (ledger.length === 0) return role;
	return role + '; ' + ledger;
}

function formatObjectLedger(object: PublicHistoryArchiveObject): string {
	if (object.checkpointLedger === null) return '';
	return 'checkpoint ' + formatInteger(object.checkpointLedger);
}

function formatObjectWork(object: PublicHistoryArchiveObject): string {
	const parts = [
		formatInteger(object.attempts) + ' attempts',
		object.bytesDownloaded === null
			? null
			: formatBytes(object.bytesDownloaded),
		object.claimedAt ? 'claimed ' + formatDateTime(object.claimedAt) : null,
		object.verifiedAt ? 'verified ' + formatDateTime(object.verifiedAt) : null,
		'updated ' + formatDateTime(object.updatedAt)
	].filter((part): part is string => part !== null && part.length > 0);

	return parts.join(' / ');
}

function formatBucketCoverageSummary(
	bucketCoverage: PublicHistoryArchiveBucketCrossCoverage
): string {
	const counts = bucketCoverage.counts;
	const totalCopies =
		counts.verifiedCopies +
		counts.scanningCopies +
		counts.pendingCopies +
		counts.failedCopies;
	const percent =
		totalCopies === 0
			? '0%'
			: formatPercent((counts.verifiedCopies / totalCopies) * 100);

	return (
		formatInteger(counts.verifiedCopies) +
		' / ' +
		formatInteger(totalCopies) +
		' archive-root references verified (' +
		percent +
		') for this bucket across ' +
		formatInteger(counts.archiveRoots) +
		' archive roots'
	);
}

function formatBucketCopyWork({
	attempts,
	bytesDownloaded,
	verifiedAt,
	updatedAt
}: PublicHistoryArchiveBucketCrossCoverage['verifiedCopies'][number]): string {
	const parts = [
		formatInteger(attempts) + ' attempts',
		bytesDownloaded === null ? null : formatBytes(bytesDownloaded),
		verifiedAt === null ? null : 'verified ' + formatDateTime(verifiedAt),
		'updated ' + formatDateTime(updatedAt)
	].filter((part): part is string => part !== null && part.length > 0);

	return parts.join(' / ');
}

function formatBytes(value: number | null): string {
	if (value === null) return 'bytes not reported';
	if (value < 1024) return formatInteger(value) + ' B';
	const units = ['KB', 'MB', 'GB', 'TB'];
	let amount = value / 1024;
	for (const unit of units) {
		if (amount < 1024) {
			return amount.toFixed(amount < 10 ? 1 : 0) + ' ' + unit;
		}
		amount /= 1024;
	}

	return amount.toFixed(1) + ' PB';
}

function formatArchiveSource(value: string): string {
	try {
		const url = new URL(value);
		const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
		return url.host + path;
	} catch {
		return value;
	}
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

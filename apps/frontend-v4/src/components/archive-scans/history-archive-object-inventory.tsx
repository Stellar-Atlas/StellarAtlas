'use client';

import type {
	PublicHistoryArchiveBucketCrossCoverage,
	PublicHistoryArchiveObject,
	PublicHistoryArchiveObjectQueue
} from '@api/types';
import { StatusPill } from '@components/status/status-ui';
import { formatDateTime, formatInteger } from '@format/formatters';
import {
	ArchiveObjectTable,
	getArchiveObjectDisplayStatus,
	isPriorityArchiveObject,
	prioritizeArchiveObjects
} from './history-archive-object-table';

interface HistoryArchiveObjectInventoryProps {
	readonly bucketCoverages?: readonly PublicHistoryArchiveBucketCrossCoverage[];
	readonly framed?: boolean;
	readonly objects: PublicHistoryArchiveObjectQueue;
	readonly priorityOpen?: boolean;
	readonly showHelperCopy?: boolean;
	readonly title?: string;
}

const MAX_PRIORITY_OBJECT_ROWS = 24;
const MAX_OBJECT_BACKLOG_ROWS = 80;

export function HistoryArchiveObjectInventory({
	bucketCoverages = [],
	framed = true,
	objects,
	priorityOpen = false,
	showHelperCopy = false,
	title = 'Archive file-check sample'
}: HistoryArchiveObjectInventoryProps): React.JSX.Element {
	const coverageByBucketHash = new Map(
		bucketCoverages.map((coverage) => [coverage.bucketHash, coverage])
	);
	const prioritizedObjects = prioritizeArchiveObjects(
		objects.objects,
		objects.generatedAt
	);
	const priorityObjects = prioritizedObjects
		.filter((object) => isPriorityArchiveObject(object, objects.generatedAt))
		.slice(0, MAX_PRIORITY_OBJECT_ROWS);
	const backlogObjects = prioritizedObjects.slice(0, MAX_OBJECT_BACKLOG_ROWS);
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
					status={
						objects.failedObjects > 0 || hasDelayedObject(objects)
							? 'degraded'
							: 'ok'
					}
					text={formatInventoryStatusText(objects)}
				/>
			</div>
			<ObjectSummary objects={objects} />
			{showHelperCopy ? (
				<p className="muted-copy">
					Each row is one archive-source file check. Bucket payload bytes
					are deduplicated by hash; repeated bucket rows are evidence that
					different archive sources referenced the same bucket file.
				</p>
			) : null}
			<ObjectPriorityTable
				coverageByBucketHash={coverageByBucketHash}
				generatedAt={objects.generatedAt}
				objects={priorityObjects}
				open={priorityOpen}
			/>
			<ObjectBacklogDetails
				coverageByBucketHash={coverageByBucketHash}
				generatedAt={objects.generatedAt}
				objects={backlogObjects}
				totalObjects={objects.objects.length}
			/>
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
		<div className="responsive-table archive-summary-table-wrap">
			<table className="archive-summary-table archive-work-summary-table">
				<thead>
					<tr>
		<th>Checking now</th>
		<th>Waiting</th>
		<th>Checks passed</th>
		<th>Evidence failures</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>{formatInteger(objects.activeObjects)}</td>
						<td>{formatInteger(objects.pendingObjects)}</td>
						<td>{formatInteger(objects.verifiedObjects)}</td>
						<td>{formatInteger(objects.failedObjects)}</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}

function ObjectPriorityTable({
	coverageByBucketHash,
	generatedAt,
	objects,
	open
}: {
	readonly coverageByBucketHash: ReadonlyMap<
		string,
		PublicHistoryArchiveBucketCrossCoverage
	>;
	readonly generatedAt: string;
	readonly objects: readonly PublicHistoryArchiveObject[];
	readonly open: boolean;
}): React.JSX.Element {
	if (objects.length === 0) {
		return (
			<p className="archive-good-state">
				No failed or delayed archive file checks are visible in this sample.
			</p>
		);
	}

	return (
		<details className="metadata-document archive-priority-block" open={open}>
			<summary>
				<span>Archive evidence needing attention</span>
				<span>{formatInteger(objects.length)} shown</span>
			</summary>
			<ArchiveObjectTable
				coverageByBucketHash={coverageByBucketHash}
				generatedAt={generatedAt}
				objects={objects}
			/>
		</details>
	);
}

function ObjectBacklogDetails({
	coverageByBucketHash,
	generatedAt,
	objects,
	totalObjects
}: {
	readonly coverageByBucketHash: ReadonlyMap<
		string,
		PublicHistoryArchiveBucketCrossCoverage
	>;
	readonly generatedAt: string;
	readonly objects: readonly PublicHistoryArchiveObject[];
	readonly totalObjects: number;
}): React.JSX.Element {
	if (totalObjects === 0) {
		return (
			<p className="muted-copy">No archive file checks match this node.</p>
		);
	}

	return (
		<details className="metadata-document archive-object-details">
			<summary>
				<span>Archive file-check sample</span>
				<span className="muted-inline">
					Showing {formatInteger(objects.length)} of{' '}
					{formatInteger(totalObjects)}
				</span>
			</summary>
			<ArchiveObjectTable
				coverageByBucketHash={coverageByBucketHash}
				generatedAt={generatedAt}
				objects={objects}
			/>
		</details>
	);
}

function hasDelayedObject(objects: PublicHistoryArchiveObjectQueue): boolean {
	return objects.objects.some(
		(object) =>
			getArchiveObjectDisplayStatus(object, objects.generatedAt) === 'delayed'
	);
}

function formatInventoryStatusText(
	objects: PublicHistoryArchiveObjectQueue
): string {
	if (objects.failedObjects > 0) {
		return formatInteger(objects.failedObjects) + ' remote failures';
	}
	if (objects.activeObjects > 0) {
		return formatInteger(objects.activeObjects) + ' checking';
	}
	if (objects.pendingObjects > 0) {
		return formatInteger(objects.pendingObjects) + ' waiting';
	}

	return formatInteger(objects.verifiedObjects) + ' verified';
}

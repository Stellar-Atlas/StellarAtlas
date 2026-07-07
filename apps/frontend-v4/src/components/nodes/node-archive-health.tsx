'use client';

import { useMemo, useState } from 'react';
import type {
	PublicHistoryArchiveBucketCrossCoverage,
	PublicHistoryArchiveObject,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveScan,
	PublicHistoryArchiveState,
	PublicNode
} from '@api/types';
import {
	ArchiveObjectTable,
	getArchiveObjectDisplayStatus,
	prioritizeArchiveObjects
} from '@components/archive-scans/history-archive-object-table';
import { HistoryArchiveObjectEventLog } from '@components/archive-scans/history-archive-object-event-log';
import { StatusPill } from '@components/status/status-ui';
import { formatDateTime, formatInteger, formatPercent } from '@format/formatters';
import { ArchiveMetadata } from './node-archive-evidence';

interface NodeArchiveHealthProps {
	readonly historyArchiveBucketCoverages: readonly PublicHistoryArchiveBucketCrossCoverage[];
	readonly historyArchiveEvents: PublicHistoryArchiveObjectEvents | null;
	readonly historyArchiveObjects: PublicHistoryArchiveObjectQueue | null;
	readonly historyArchiveScan: PublicHistoryArchiveScan | null;
	readonly historyArchiveState: PublicHistoryArchiveState | null;
	readonly historyArchiveSummary: PublicHistoryArchiveObjectSummary | null;
	readonly node: PublicNode;
}

type ArchiveHealthTab =
	| 'attention'
	| 'active'
	| 'verified'
	| 'pending'
	| 'state'
	| 'activity'
	| 'raw';

const maxTableRows = 80;

export function NodeArchiveHealth({
	historyArchiveBucketCoverages,
	historyArchiveEvents,
	historyArchiveObjects,
	historyArchiveScan,
	historyArchiveState,
	historyArchiveSummary,
	node
}: NodeArchiveHealthProps): React.JSX.Element {
	const [tab, setTab] = useState<ArchiveHealthTab>('attention');
	const coverageByBucketHash = useMemo(
		() =>
			new Map(
				historyArchiveBucketCoverages.map((coverage) => [
					coverage.bucketHash,
					coverage
				])
			),
		[historyArchiveBucketCoverages]
	);
	const prioritizedObjects = useMemo(
		() =>
			historyArchiveObjects
				? prioritizeArchiveObjects(
						historyArchiveObjects.objects,
						historyArchiveObjects.generatedAt
					)
				: [],
		[historyArchiveObjects]
	);
	const objectsForCurrentTab = getObjectsForTab(
		prioritizedObjects,
		historyArchiveObjects?.generatedAt ?? '',
		tab
	).slice(0, maxTableRows);

	return (
		<article className="panel detail-panel archive-panel archive-health-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive health</h2>
					<span className="muted-inline">
						{historyArchiveSummary
							? `Updated ${formatDateTime(historyArchiveSummary.generatedAt)}`
							: 'No scanner-owned archive evidence yet'}
					</span>
				</div>
				<StatusPill
					status={getArchivePanelStatus(historyArchiveSummary)}
					text={getArchivePanelStatusText(historyArchiveSummary)}
				/>
			</div>
			<ArchiveHealthSummary
				historyArchiveState={historyArchiveState}
				node={node}
				summary={historyArchiveSummary}
			/>
			<ArchiveHealthTabs activeTab={tab} onSelect={setTab} />
			<div className="archive-health-tab-panel">
				{tab === 'state' ? (
					<ArchiveMetadata
						historyArchiveScan={historyArchiveScan}
						historyArchiveState={historyArchiveState}
						node={node}
					/>
				) : null}
				{tab === 'activity' && historyArchiveEvents ? (
					<HistoryArchiveObjectEventLog
						events={historyArchiveEvents}
						framed={false}
						title="Recent archive file activity"
					/>
				) : null}
				{tab === 'raw' ? (
					<RawArchiveEvidence
						events={historyArchiveEvents}
						objects={historyArchiveObjects}
						state={historyArchiveState}
						summary={historyArchiveSummary}
					/>
				) : null}
				{isObjectTableTab(tab) ? (
					<ArchiveObjectTableOrEmpty
						coverageByBucketHash={coverageByBucketHash}
						generatedAt={historyArchiveObjects?.generatedAt ?? ''}
						objects={objectsForCurrentTab}
						tab={tab}
					/>
				) : null}
			</div>
		</article>
	);
}

function ArchiveHealthSummary({
	historyArchiveState,
	node,
	summary
}: {
	readonly historyArchiveState: PublicHistoryArchiveState | null;
	readonly node: PublicNode;
	readonly summary: PublicHistoryArchiveObjectSummary | null;
}): React.JSX.Element {
	return (
		<div className="responsive-table archive-health-summary-wrap">
			<table className="archive-health-summary-table">
				<thead>
					<tr>
						<th>Archive root</th>
						<th>History state</th>
						<th>Files verified</th>
						<th>Checkpoint proof</th>
						<th>Bucket references</th>
						<th>Active</th>
						<th>Failures</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>{formatArchiveRoot(node.historyUrl)}</td>
						<td>{historyArchiveState?.status ?? 'not captured'}</td>
						<td>
							{summary
								? formatCoverage(summary.verifiedObjects, summary.totalObjects)
								: '0 / 0'}
						</td>
						<td>{summary ? formatCheckpointProof(summary) : 'not evaluated'}</td>
						<td>
							{summary
								? formatCoverage(
										summary.buckets.verifiedBucketObjects,
										summary.buckets.totalBucketObjects
									)
								: '0 / 0'}
						</td>
						<td>{formatInteger(summary?.activeObjects ?? 0)}</td>
						<td>{formatInteger(summary?.failedObjects ?? 0)}</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}

function ArchiveHealthTabs({
	activeTab,
	onSelect
}: {
	readonly activeTab: ArchiveHealthTab;
	readonly onSelect: (tab: ArchiveHealthTab) => void;
}): React.JSX.Element {
	return (
		<div className="archive-health-tabs segmented" aria-label="Archive health view">
			{archiveHealthTabs.map((tab) => (
				<button
					aria-pressed={activeTab === tab.value}
					className={activeTab === tab.value ? 'active' : ''}
					key={tab.value}
					onClick={() => onSelect(tab.value)}
					type="button"
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}

function ArchiveObjectTableOrEmpty({
	coverageByBucketHash,
	generatedAt,
	objects,
	tab
}: {
	readonly coverageByBucketHash: ReadonlyMap<
		string,
		PublicHistoryArchiveBucketCrossCoverage
	>;
	readonly generatedAt: string;
	readonly objects: readonly PublicHistoryArchiveObject[];
	readonly tab: ArchiveHealthTab;
}): React.JSX.Element {
	if (objects.length === 0) {
		return <p className="archive-good-state">{getEmptyTabText(tab)}</p>;
	}

	return (
		<ArchiveObjectTable
			coverageByBucketHash={coverageByBucketHash}
			generatedAt={generatedAt}
			objects={objects}
		/>
	);
}

function RawArchiveEvidence({
	events,
	objects,
	state,
	summary
}: {
	readonly events: PublicHistoryArchiveObjectEvents | null;
	readonly objects: PublicHistoryArchiveObjectQueue | null;
	readonly state: PublicHistoryArchiveState | null;
	readonly summary: PublicHistoryArchiveObjectSummary | null;
}): React.JSX.Element {
	return (
		<div className="archive-raw-evidence">
			<RawJsonDetails label="Summary JSON" value={summary} />
			<RawJsonDetails label="History archive state JSON" value={state} />
			<RawJsonDetails
				label="Current work sample JSON"
				value={objects ? { ...objects, objects: objects.objects.slice(0, 20) } : null}
			/>
			<RawJsonDetails
				label="Recent event sample JSON"
				value={events ? { ...events, events: events.events.slice(0, 20) } : null}
			/>
		</div>
	);
}

function RawJsonDetails({
	label,
	value
}: {
	readonly label: string;
	readonly value: unknown;
}): React.JSX.Element {
	return (
		<details className="metadata-document">
			<summary>
				<span>{label}</span>
				<span className="muted-inline">{value === null ? 'not available' : 'available'}</span>
			</summary>
			<pre>{JSON.stringify(value, null, 2)}</pre>
		</details>
	);
}

function getObjectsForTab(
	objects: readonly PublicHistoryArchiveObject[],
	generatedAt: string,
	tab: ArchiveHealthTab
): readonly PublicHistoryArchiveObject[] {
	if (!isObjectTableTab(tab)) return [];
	return objects.filter((object) => {
		const status = getArchiveObjectDisplayStatus(object, generatedAt);
		if (tab === 'attention') {
			return (
				status === 'failed' ||
				status === 'delayed' ||
				(object.objectType === 'history-archive-state' && status !== 'verified')
			);
		}
		if (tab === 'active') return status === 'scanning' || status === 'delayed';
		return status === tab;
	});
}

function isObjectTableTab(tab: ArchiveHealthTab): boolean {
	return (
		tab === 'attention' ||
		tab === 'active' ||
		tab === 'verified' ||
		tab === 'pending'
	);
}

function getEmptyTabText(tab: ArchiveHealthTab): string {
	if (tab === 'attention') {
		return 'No failed, delayed, or missing history-state file checks are in this snapshot.';
	}
	if (tab === 'active') return 'No archive file checks are active right now.';
	if (tab === 'verified') return 'No verified archive file rows are in this sample.';
	if (tab === 'pending') return 'No pending archive file rows are in this sample.';
	return 'No archive evidence is available for this tab.';
}

function getArchivePanelStatus(
	summary: PublicHistoryArchiveObjectSummary | null
): 'degraded' | 'ok' {
	return summary && summary.failedObjects > 0 ? 'degraded' : 'ok';
}

function getArchivePanelStatusText(
	summary: PublicHistoryArchiveObjectSummary | null
): string {
	if (!summary) return 'unchecked';
	if (summary.failedObjects > 0) {
		return `${formatInteger(summary.failedObjects)} failures`;
	}
	return `${formatInteger(summary.verifiedObjects)} files verified`;
}

function formatArchiveRoot(value: string | null): string {
	if (!value) return 'none reported';
	try {
		const url = new URL(value);
		return url.host + (url.pathname === '/' ? '' : url.pathname.replace(/\/$/, ''));
	} catch {
		return value;
	}
}

function formatCheckpointProof(summary: PublicHistoryArchiveObjectSummary): string {
	const checkpoints = summary.checkpoints;
	if (checkpoints.categoryConsistentArchiveCheckpoints > 0) {
		return formatCoverage(
			checkpoints.categoryConsistentArchiveCheckpoints,
			checkpoints.expectedArchiveCheckpoints
		);
	}
	if (checkpoints.categoryConsistencyNotEvaluatedCheckpoints > 0) {
		return `${formatInteger(checkpoints.categoryConsistencyNotEvaluatedCheckpoints)} not evaluated`;
	}
	return 'not evaluated';
}

function formatCoverage(verified: number, total: number): string {
	if (total <= 0) return '0 / 0';
	return `${formatInteger(verified)} / ${formatInteger(total)} (${formatPercent(
		(verified / total) * 100
	)})`;
}

const archiveHealthTabs: readonly {
	readonly label: string;
	readonly value: ArchiveHealthTab;
}[] = [
	{ label: 'Needs attention', value: 'attention' },
	{ label: 'Active checks', value: 'active' },
	{ label: 'Verified files', value: 'verified' },
	{ label: 'Pending files', value: 'pending' },
	{ label: 'History archive state', value: 'state' },
	{ label: 'Recent activity', value: 'activity' },
	{ label: 'Raw JSON', value: 'raw' }
];

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
import type { PublicHistoryArchiveRepairPlan } from '@api/archive-repair-types';
import {
	ArchiveObjectTable,
	prioritizeArchiveObjects
} from '@components/archive-scans/history-archive-object-table';
import { HistoryArchiveObjectEventLog } from '@components/archive-scans/history-archive-object-event-log';
import { StatusPill } from '@components/status/status-ui';
import {
	formatDateTime,
	formatInteger,
	formatPercent
} from '@format/formatters';
import { ArchiveMetadata } from './node-archive-evidence';
import { NodeArchiveRawEvidence } from './node-archive-raw-evidence';
import { NodeArchiveRepairPlan } from './node-archive-repair-plan';
import {
	archiveHealthTabs,
	countArchiveHealthTabs,
	formatArchiveHealthTabLabel,
	getArchivePanelStatus,
	getArchivePanelStatusText,
	getCheckpointProofWaitText,
	getObjectsForArchiveHealthTab,
	isArchiveObjectTableTab,
	maxArchiveHealthTableRows,
	type ArchiveHealthTab,
	type ArchiveHealthTabCounts
} from './node-archive-health-model';
import {
	checkpointProofIsComplete,
	getPendingBucketCheckCount
} from '@domain/history-archive-proof';

interface NodeArchiveHealthProps {
	readonly historyArchiveBucketCoverages: readonly PublicHistoryArchiveBucketCrossCoverage[];
	readonly historyArchiveEvents: PublicHistoryArchiveObjectEvents | null;
	readonly historyArchiveObjects: PublicHistoryArchiveObjectQueue | null;
	readonly historyArchiveRepairPlan: PublicHistoryArchiveRepairPlan | null;
	readonly historyArchiveScan: PublicHistoryArchiveScan | null;
	readonly historyArchiveState: PublicHistoryArchiveState | null;
	readonly historyArchiveSummary: PublicHistoryArchiveObjectSummary | null;
	readonly node: PublicNode;
}

export function NodeArchiveHealth({
	historyArchiveBucketCoverages,
	historyArchiveEvents,
	historyArchiveObjects,
	historyArchiveRepairPlan,
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
	const tabCounts = useMemo(
		() =>
			countArchiveHealthTabs(
				prioritizedObjects,
				historyArchiveObjects?.generatedAt ?? ''
			),
		[historyArchiveObjects?.generatedAt, prioritizedObjects]
	);
	const objectsForCurrentTab = getObjectsForArchiveHealthTab(
		prioritizedObjects,
		historyArchiveObjects?.generatedAt ?? '',
		tab
	).slice(0, maxArchiveHealthTableRows);

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
			<ArchiveHealthTabs activeTab={tab} counts={tabCounts} onSelect={setTab} />
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
					<NodeArchiveRawEvidence
						events={historyArchiveEvents}
						objects={historyArchiveObjects}
						state={historyArchiveState}
						summary={historyArchiveSummary}
					/>
				) : null}
				{isArchiveObjectTableTab(tab) ? (
					<>
						{tab === 'attention' &&
						historyArchiveRepairPlan !== null &&
						(historyArchiveRepairPlan.actions.length > 0 ||
							historyArchiveRepairPlan.infrastructureBlocks.length > 0) ? (
							<NodeArchiveRepairPlan repairPlan={historyArchiveRepairPlan} />
						) : null}
						<ArchiveObjectTableOrEmpty
							coverageByBucketHash={coverageByBucketHash}
							generatedAt={historyArchiveObjects?.generatedAt ?? ''}
							objects={objectsForCurrentTab}
							summary={historyArchiveSummary}
							tab={tab}
						/>
					</>
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
						<th>Archive source</th>
						<th>History archive state</th>
						<th>Files checked</th>
						<th>Checkpoint proof</th>
						<th>Bucket copies</th>
						<th>Active</th>
						<th>Failures</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>{formatArchiveRoot(node.historyUrl)}</td>
						<td>
							<strong>{formatArchiveStateSummary(historyArchiveState)}</strong>
							<small>{formatArchiveStateDetail(historyArchiveState)}</small>
						</td>
						<td>
							{summary
								? formatCoverage(summary.verifiedObjects, summary.totalObjects)
								: '0 / 0'}
						</td>
						<td>
							{summary ? formatCheckpointProof(summary) : 'not checked yet'}
						</td>
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
	counts,
	onSelect
}: {
	readonly activeTab: ArchiveHealthTab;
	readonly counts: ArchiveHealthTabCounts;
	readonly onSelect: (tab: ArchiveHealthTab) => void;
}): React.JSX.Element {
	return (
		<div
			className="archive-health-tabs segmented"
			aria-label="Archive evidence view"
		>
			{archiveHealthTabs.map((tab) => (
				<button
					aria-pressed={activeTab === tab.value}
					className={activeTab === tab.value ? 'active' : ''}
					key={tab.value}
					onClick={() => onSelect(tab.value)}
					type="button"
				>
					{formatArchiveHealthTabLabel(tab.label, tab.value, counts)}
				</button>
			))}
		</div>
	);
}

function ArchiveObjectTableOrEmpty({
	coverageByBucketHash,
	generatedAt,
	objects,
	summary,
	tab
}: {
	readonly coverageByBucketHash: ReadonlyMap<
		string,
		PublicHistoryArchiveBucketCrossCoverage
	>;
	readonly generatedAt: string;
	readonly objects: readonly PublicHistoryArchiveObject[];
	readonly summary: PublicHistoryArchiveObjectSummary | null;
	readonly tab: ArchiveHealthTab;
}): React.JSX.Element {
	if (objects.length === 0) {
		return (
			<p className="archive-good-state">
				{getEmptyTabText(tab, summary)}
			</p>
		);
	}

	return (
		<ArchiveObjectTable
			coverageByBucketHash={coverageByBucketHash}
			generatedAt={generatedAt}
			objects={objects}
		/>
	);
}

function getEmptyTabText(
	tab: ArchiveHealthTab,
	summary: PublicHistoryArchiveObjectSummary | null
): string {
	if (tab === 'attention') {
		if (summary !== null && !checkpointProofIsComplete(summary)) {
			return getCheckpointProofWaitText(summary);
		}
		return 'No failed or delayed archive file checks are visible in this snapshot.';
	}
	if (tab === 'active') return 'No archive file checks are active right now.';
	if (tab === 'verified')
		return 'No passed archive file checks are in this sample.';
	if (tab === 'pending') return 'No waiting archive file checks are in this sample.';
	return 'No archive file evidence is available for this tab.';
}

function formatArchiveRoot(value: string | null): string {
	if (!value) return 'none reported';
	try {
		const url = new URL(value);
		return (
			url.host + (url.pathname === '/' ? '' : url.pathname.replace(/\/$/, ''))
		);
	} catch {
		return value;
	}
}

function formatArchiveStateSummary(
	state: PublicHistoryArchiveState | null
): string {
	if (state === null) return 'not captured';
	if (state.status !== 'available') return state.status;
	const currentLedger = state.metadata?.stellarHistory.currentLedger;
	if (typeof currentLedger !== 'number') return 'captured';
	return 'checkpoint ' + formatInteger(currentLedger);
}

function formatArchiveStateDetail(
	state: PublicHistoryArchiveState | null
): string {
	if (state === null) return 'scanner has not captured the root pointer yet';
	if (state.failure !== null) {
		return sanitizeStateFailure(state.failure.message);
	}
	const buckets = state.metadata?.stellarHistory.currentBuckets.length ?? null;
	const observed = 'observed ' + formatDateTime(state.observedAt);
	if (buckets === null) return `${state.source}; ${observed}`;
	return `${formatInteger(buckets)} bucket levels; ${state.source}; ${observed}`;
}

function sanitizeStateFailure(value: string): string {
	return value.replace(
		/(?:file:\/\/)?\/(?:home|var|tmp|etc|opt|srv|mnt|root|usr)\/[^\s'"<>)]*/g,
		'[internal path]'
	);
}

function formatCheckpointProof(
	summary: PublicHistoryArchiveObjectSummary
): string {
	const checkpoints = summary.checkpoints;
	if (checkpoints.categoryConsistentArchiveCheckpoints > 0) {
		return formatCoverage(
			checkpoints.categoryConsistentArchiveCheckpoints,
			checkpoints.expectedArchiveCheckpoints
		);
	}
	const pendingBuckets = getPendingBucketCheckCount(summary);
	if (
		checkpoints.categoryConsistencyNotEvaluatedCheckpoints > 0 &&
		pendingBuckets > 0
	) {
		return `${formatInteger(
			checkpoints.categoryConsistencyNotEvaluatedCheckpoints
		)} waiting for ${formatInteger(pendingBuckets)} bucket copies`;
	}
	if (checkpoints.categoryConsistencyNotEvaluatedCheckpoints > 0) {
		return `${formatInteger(checkpoints.categoryConsistencyNotEvaluatedCheckpoints)} waiting for proof facts`;
	}
	return 'not checked yet';
}

function formatCoverage(verified: number, total: number): string {
	if (total <= 0) return '0 / 0';
	return `${formatInteger(verified)} / ${formatInteger(total)} (${formatPercent(
		(verified / total) * 100
	)})`;
}

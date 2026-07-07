import Link from 'next/link';
import type {
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveState,
	PublicNode
} from '@api/types';
import { getNodeLabel } from '@domain/network';
import { formatDateTime, formatInteger } from '@format/formatters';
import { HistoryArchiveObjectCoverage } from './history-archive-object-coverage';
import { HistoryArchiveObjectEventLog } from './history-archive-object-event-log';
import { HistoryArchiveObjectInventory } from './history-archive-object-inventory';
import { HistoryArchiveStateDocument } from './history-archive-state-document';

export interface OrganizationArchiveState {
	readonly events: PublicHistoryArchiveObjectEvents;
	readonly historyUrl: string;
	readonly objects: PublicHistoryArchiveObjectQueue;
	readonly state: PublicHistoryArchiveState | null;
	readonly summary: PublicHistoryArchiveObjectSummary;
}

interface OrganizationArchiveEvidenceProps {
	readonly archiveStates: readonly OrganizationArchiveState[];
	readonly nodes: readonly PublicNode[];
}

interface ArchiveRootEvidence {
	readonly archiveNodes: readonly PublicNode[];
	readonly evidence: OrganizationArchiveState | null;
	readonly historyUrl: string;
}

export function OrganizationArchiveEvidence({
	archiveStates,
	nodes
}: OrganizationArchiveEvidenceProps): React.JSX.Element {
	const archiveRoots = getArchiveRoots(nodes, archiveStates);
	const rootsWithEvidence = archiveRoots.filter(
		(archiveRoot) => archiveRoot.evidence !== null
	).length;

	return (
		<article className="panel detail-panel archive-panel archive-metadata">
			<div className="panel-heading">
				<h2>History archive evidence</h2>
				<span className="muted-inline">
					{formatInteger(archiveRoots.length)} archive sources;{' '}
					{formatInteger(rootsWithEvidence)} with scanner object evidence
				</span>
			</div>
			{archiveRoots.length === 0 ? (
				<p className="muted-copy">
					No archive sources are known for this organization.
				</p>
			) : (
				<ArchiveRootEvidenceTable archiveRoots={archiveRoots} />
			)}
		</article>
	);
}

function ArchiveRootEvidenceTable({
	archiveRoots
}: {
	readonly archiveRoots: readonly ArchiveRootEvidence[];
}): React.JSX.Element {
	return (
		<div className="responsive-table">
			<table>
				<thead>
					<tr>
						<th>Archive source</th>
						<th>Nodes</th>
						<th>Latest pointer</th>
						<th>Object checks</th>
						<th>Bucket references</th>
						<th>Cross-file checks</th>
						<th>Recent activity</th>
					</tr>
				</thead>
				<tbody>
					{archiveRoots.map((archiveRoot) => (
						<ArchiveRootEvidenceRows
							archiveRoot={archiveRoot}
							key={normalizeArchiveUrl(archiveRoot.historyUrl)}
						/>
					))}
				</tbody>
			</table>
		</div>
	);
}

function ArchiveRootEvidenceRows({
	archiveRoot
}: {
	readonly archiveRoot: ArchiveRootEvidence;
}): React.JSX.Element {
	const evidence = archiveRoot.evidence;

	return (
		<>
			<tr>
				<td>
					<a
						className="archive-object-url"
						href={archiveRoot.historyUrl}
						rel="noopener noreferrer"
						target="_blank"
					>
						{formatArchiveSource(archiveRoot.historyUrl)}
					</a>
				</td>
				<td>{formatNodeSummary(archiveRoot.archiveNodes)}</td>
				<td>{formatStateSummary(evidence?.state ?? null)}</td>
				<td>{formatObjectCheckSummary(evidence?.summary ?? null)}</td>
				<td>{formatBucketReferenceSummary(evidence?.summary ?? null)}</td>
				<td>{formatCrossFileCheckSummary(evidence?.summary ?? null)}</td>
				<td>{formatEventSample(evidence?.events ?? null)}</td>
			</tr>
			<tr>
				<td colSpan={7}>
					<ArchiveRootDrilldown archiveRoot={archiveRoot} />
				</td>
			</tr>
		</>
	);
}

function ArchiveRootDrilldown({
	archiveRoot
}: {
	readonly archiveRoot: ArchiveRootEvidence;
}): React.JSX.Element {
	const evidence = archiveRoot.evidence;

	return (
		<details className="metadata-document">
			<summary>
				<span>Raw state and archive file evidence</span>
				<a
					href={archiveRoot.historyUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					{archiveRoot.historyUrl}
				</a>
			</summary>
			<dl className="details">
				<div>
					<dt>Latest checkpoint pointer</dt>
					<dd>{formatStateSummary(evidence?.state ?? null)}</dd>
				</div>
				<div>
					<dt>Archive file checks</dt>
					<dd>{formatObjectCheckSummary(evidence?.summary ?? null)}</dd>
				</div>
				<div>
					<dt>Bucket references</dt>
					<dd>{formatBucketReferenceSummary(evidence?.summary ?? null)}</dd>
				</div>
				<div>
					<dt>Cross-file checks</dt>
					<dd>{formatCrossFileCheckSummary(evidence?.summary ?? null)}</dd>
				</div>
				<div>
					<dt>Archive file-check sample</dt>
					<dd>{formatObjectSample(evidence?.objects ?? null)}</dd>
				</div>
				<div>
					<dt>Recent event sample</dt>
					<dd>{formatEventSample(evidence?.events ?? null)}</dd>
				</div>
			</dl>
			<ArchiveNodeList nodes={archiveRoot.archiveNodes} />
			<HistoryArchiveStateDocument
				archiveState={evidence?.state ?? null}
				archiveUrl={archiveRoot.historyUrl}
			/>
			{evidence ? (
				<>
					<HistoryArchiveObjectCoverage
						framed={false}
						summary={evidence.summary}
						title="Archive file checks"
					/>
					<HistoryArchiveObjectInventory
						framed={false}
						objects={evidence.objects}
						title="Archive file-check sample"
					/>
					<HistoryArchiveObjectEventLog
						events={evidence.events}
						framed={false}
						title="Recent archive file event sample"
					/>
				</>
			) : (
				<p className="muted-copy">
					No scanner-captured archive file evidence is available for this source
					yet.
				</p>
			)}
		</details>
	);
}

function formatNodeSummary(nodes: readonly PublicNode[]): React.JSX.Element {
	if (nodes.length === 0) {
		return <span className="muted-inline">Scanner source only</span>;
	}

	return (
		<>
			<strong>{formatInteger(nodes.length)} nodes</strong>
			<span className="muted-inline">{formatNodeSamples(nodes)}</span>
		</>
	);
}

function ArchiveNodeList({
	nodes
}: {
	readonly nodes: readonly PublicNode[];
}): React.JSX.Element {
	if (nodes.length === 0) {
		return (
			<p className="muted-copy">
				This archive source was returned by the scanner but is not attached to a
				current organization node snapshot.
			</p>
		);
	}

	return (
		<div className="table">
			{nodes.map((node) => (
				<div className="row compact" key={node.publicKey}>
					<div>
						<Link href={`/nodes/${encodeURIComponent(node.publicKey)}`}>
							<strong>{getNodeLabel(node)}</strong>
						</Link>
						<small>{node.versionStr ?? node.publicKey}</small>
					</div>
					<div className="metric">
						<strong>{node.isValidating ? 'Validating' : 'Watch'}</strong>
						<small>
							{node.active ? 'active snapshot' : 'inactive snapshot'}
						</small>
					</div>
				</div>
			))}
		</div>
	);
}

function getArchiveRoots(
	nodes: readonly PublicNode[],
	archiveStates: readonly OrganizationArchiveState[]
): readonly ArchiveRootEvidence[] {
	const evidenceByUrl = new Map(
		archiveStates.map((entry) => [normalizeArchiveUrl(entry.historyUrl), entry])
	);
	const rootsByUrl = new Map<
		string,
		{
			archiveNodes: PublicNode[];
			evidence: OrganizationArchiveState | null;
			historyUrl: string;
		}
	>();

	for (const node of nodes) {
		if (node.historyUrl === null) continue;
		const key = normalizeArchiveUrl(node.historyUrl);
		const existing = rootsByUrl.get(key);
		if (existing) {
			existing.archiveNodes.push(node);
			continue;
		}
		rootsByUrl.set(key, {
			archiveNodes: [node],
			evidence: evidenceByUrl.get(key) ?? null,
			historyUrl: node.historyUrl
		});
	}

	for (const entry of archiveStates) {
		const key = normalizeArchiveUrl(entry.historyUrl);
		if (rootsByUrl.has(key)) continue;
		rootsByUrl.set(key, {
			archiveNodes: [],
			evidence: entry,
			historyUrl: entry.historyUrl
		});
	}

	return Array.from(rootsByUrl.values());
}

function formatStateSummary(state: PublicHistoryArchiveState | null): string {
	if (state === null) return 'Not captured by scanner yet';
	if (state.metadata === null) {
		return `${state.status} at ${formatDateTime(state.observedAt)}`;
	}
	return `${state.status}; ledger ${formatInteger(
		state.metadata.stellarHistory.currentLedger
	)} observed ${formatDateTime(state.observedAt)}`;
}

function formatObjectCheckSummary(
	summary: PublicHistoryArchiveObjectSummary | null
): string {
	if (summary === null) return 'No archive file-check summary stored';
	return `${formatInteger(summary.verifiedObjects)} verified of ${formatInteger(
		summary.totalObjects
	)} file checks; ${formatInteger(summary.activeObjects)} checking; ${formatInteger(
		summary.pendingObjects
	)} waiting; ${formatInteger(summary.failedObjects)} evidence failures`;
}

function formatBucketReferenceSummary(
	summary: PublicHistoryArchiveObjectSummary | null
): string {
	if (summary === null) return 'No bucket-reference summary stored';
	return `${formatInteger(
		summary.buckets.verifiedBucketObjects
	)} verified of ${formatInteger(
		summary.buckets.totalBucketObjects
	)} bucket references; ${formatInteger(
		summary.buckets.uniqueBucketHashes
	)} unique bucket files`;
}

function formatCrossFileCheckSummary(
	summary: PublicHistoryArchiveObjectSummary | null
): string {
	if (summary === null) return 'No cross-file check summary stored';
	return `${formatInteger(
		summary.checkpoints.categoryConsistentArchiveCheckpoints
	)} checkpoint file sets agree; ${formatInteger(
		summary.checkpoints.objectCompleteArchiveCheckpoints
	)} complete; ${formatInteger(
		summary.checkpoints.categoryConsistencyFailedCheckpoints
	)} failed; ${formatInteger(
		summary.checkpoints.categoryConsistencyPendingCheckpoints
	)} waiting`;
}

function formatObjectSample(
	objects: PublicHistoryArchiveObjectQueue | null
): string {
	if (objects === null) return 'No archive file-check sample stored';
	if (objects.objects.length === 0)
		return 'No sampled archive file checks returned';
	return `${formatInteger(objects.objects.length)} sampled of ${formatInteger(
		objects.activeObjects +
			objects.pendingObjects +
			objects.verifiedObjects +
			objects.failedObjects
	)} archive file checks`;
}

function formatEventSample(
	events: PublicHistoryArchiveObjectEvents | null
): string {
	if (events === null) return 'No recent archive file activity stored';
	const latest = events.events.at(0);
	if (latest === undefined) return 'No recent archive file activity returned';
	return `${latest.eventType} ${latest.objectType} at ${formatDateTime(
		latest.createdAt
	)}`;
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

function normalizeArchiveUrl(historyUrl: string): string {
	return historyUrl.replace(/\/+$/, '').toLowerCase();
}

function formatNodeSamples(nodes: readonly PublicNode[]): string {
	const sample = nodes.slice(0, 3).map(getNodeLabel).join(', ');
	const remainingNodes = nodes.length - 3;
	if (remainingNodes <= 0) return sample;
	return `${sample}, ${formatInteger(remainingNodes)} more`;
}

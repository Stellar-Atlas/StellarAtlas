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

	return (
		<article className="panel detail-panel archive-metadata">
			<div className="panel-heading">
				<h2>History archive evidence</h2>
				<span className="muted-inline">
					{formatInteger(archiveRoots.length)} archive roots
				</span>
			</div>
			{archiveRoots.length === 0 ? (
				<p className="muted-copy">
					No node archive URLs are known for this organization.
				</p>
			) : (
				archiveRoots.map((archiveRoot) => (
					<ArchiveRootDrilldown
						archiveRoot={archiveRoot}
						key={normalizeArchiveUrl(archiveRoot.historyUrl)}
					/>
				))
			)}
		</article>
	);
}

function ArchiveRootDrilldown({
	archiveRoot
}: {
	readonly archiveRoot: ArchiveRootEvidence;
}): React.JSX.Element {
	const evidence = archiveRoot.evidence;

	return (
		<details className="metadata-document" open>
			<summary>
				<span>{formatArchiveSource(archiveRoot.historyUrl)}</span>
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
					<dt>Scanner-owned state</dt>
					<dd>{formatStateSummary(evidence?.state ?? null)}</dd>
				</div>
				<div>
					<dt>Archive file coverage</dt>
					<dd>{formatCoverageSummary(evidence?.summary ?? null)}</dd>
				</div>
				<div>
					<dt>Archive file sample</dt>
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
						title="Archive file coverage"
					/>
					<HistoryArchiveObjectInventory
						framed={false}
						objects={evidence.objects}
						title="Archive file sample"
					/>
					<HistoryArchiveObjectEventLog
						events={evidence.events}
						framed={false}
						title="Recent archive file event sample"
					/>
				</>
			) : (
				<p className="muted-copy">
					No scanner-owned archive file evidence is available for this root
					yet.
				</p>
			)}
		</details>
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
				This archive root was returned by the scanner but is not attached to a
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
	if (state === null) return 'No scanner-owned state row stored';
	if (state.metadata === null) {
		return `${state.status} at ${formatDateTime(state.observedAt)}`;
	}
	return `${state.status}; ledger ${formatInteger(
		state.metadata.stellarHistory.currentLedger
	)} observed ${formatDateTime(state.observedAt)}`;
}

function formatCoverageSummary(
	summary: PublicHistoryArchiveObjectSummary | null
): string {
	if (summary === null) return 'No archive file coverage summary stored';
	return `${formatInteger(summary.verifiedObjects)} verified of ${formatInteger(
		summary.totalObjects
	)} file checks; ${formatInteger(
		summary.checkpoints.objectCompleteArchiveCheckpoints
	)} complete checkpoints`;
}

function formatObjectSample(
	objects: PublicHistoryArchiveObjectQueue | null
): string {
	if (objects === null) return 'No archive file check sample stored';
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

import Link from 'next/link';
import type {
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicNetwork,
	PublicNode,
	PublicHistoryArchiveState,
	PublicOrganization
} from '../../api/types';
import {
	getNodeLabel,
	getOrganizationLabel,
	getOrganizationTags
} from '../../domain/network';
import {
	formatNode30DayValidating,
	formatOrganization24HourAvailability,
	formatOrganization30DayAvailability
} from '../../domain/availability';
import {
	formatBoolean,
	formatDateTime,
	formatInteger
} from '../../format/formatters';
import { StatusTags } from '../status-tags';

interface OrganizationDetailProps {
	archiveStates: readonly OrganizationArchiveState[];
	network: PublicNetwork;
	organization: PublicOrganization;
	organizationNodes: readonly PublicNode[];
}

interface OrganizationArchiveState {
	readonly events: PublicHistoryArchiveObjectEvents;
	readonly historyUrl: string;
	readonly objects: PublicHistoryArchiveObjectQueue;
	readonly state: PublicHistoryArchiveState | null;
}

export function OrganizationDetail({
	archiveStates,
	network,
	organization,
	organizationNodes
}: OrganizationDetailProps): React.JSX.Element {
	const validators = organization.validators
		.map((publicKey): PublicNode | null =>
			network.nodes.find((node) => node.publicKey === publicKey) ?? null
		)
		.filter((node): node is PublicNode => node !== null);
	const availability24Hours = formatOrganization24HourAvailability(organization);
	const availability30Days = formatOrganization30DayAvailability(organization);

	return (
		<section className="detail-grid">
			<article className="panel detail-panel">
				<div className="panel-heading">
					<h2>Organization status</h2>
					<StatusTags tags={getOrganizationTags(organization)} />
				</div>
				<dl className="details">
					<div><dt>Home domain</dt><dd>{organization.homeDomain}</dd></div>
					<div><dt>URL</dt><dd>{organization.url ?? 'Not reported'}</dd></div>
					<div><dt>Horizon</dt><dd>{organization.horizonUrl ?? 'Not reported'}</dd></div>
					<div><dt>Validators</dt><dd>{organization.validators.length}</dd></div>
					<div><dt>Subquorum available</dt><dd>{formatBoolean(organization.subQuorumAvailable)}</dd></div>
					<div>
						<dt>24H availability</dt>
						<dd>
							<span className={`metric-text ${availability24Hours.tone}`}>
								{availability24Hours.value}
							</span>
							{availability24Hours.detail ? <small>{availability24Hours.detail}</small> : null}
						</dd>
					</div>
					<div>
						<dt>30D availability</dt>
						<dd>
							<span className={`metric-text ${availability30Days.tone}`}>
								{availability30Days.value}
							</span>
							{availability30Days.detail ? <small>{availability30Days.detail}</small> : null}
						</dd>
					</div>
				</dl>
			</article>
			<article className="panel detail-panel">
				<div className="panel-heading"><h2>Validators</h2></div>
				<div className="table">
					{validators.map((node) => (
						<div className="row compact" key={node.publicKey}>
							<div>
								<Link href={`/nodes/${encodeURIComponent(node.publicKey)}`}>
									<strong>{getNodeLabel(node)}</strong>
								</Link>
								<small>{node.versionStr ?? node.publicKey}</small>
							</div>
							<div className="metric">
								<strong>{node.isValidating ? 'Validating' : 'Watch'}</strong>
								<small>{formatNode30DayValidating(node).value}</small>
							</div>
						</div>
					))}
				</div>
			</article>
			<OrganizationArchiveEvidence
				archiveStates={archiveStates}
				nodes={organizationNodes}
			/>
			<OrganizationTomlEvidence organization={organization} />
		</section>
	);
}

function OrganizationArchiveEvidence({
	archiveStates,
	nodes
}: {
	readonly archiveStates: readonly OrganizationArchiveState[];
	readonly nodes: readonly PublicNode[];
}): React.JSX.Element {
	const stateByUrl = new Map(
		archiveStates.map((entry) => [normalizeArchiveUrl(entry.historyUrl), entry])
	);
	const nodesWithArchives = nodes.filter((node) => node.historyUrl !== null);

	return (
		<article className="panel detail-panel archive-metadata">
			<div className="panel-heading">
				<h2>History archive state</h2>
				<span className="muted-inline">
					{formatInteger(nodesWithArchives.length)} archives
				</span>
			</div>
			{nodesWithArchives.length === 0 ? (
				<p className="muted-copy">
					No node archive URLs are known for this organization.
				</p>
			) : (
				<div className="table">
					{nodesWithArchives.map((node) => {
						const historyUrl = node.historyUrl ?? '';
						const archiveState =
							stateByUrl.get(normalizeArchiveUrl(historyUrl))?.state ?? null;
						const objects =
							stateByUrl.get(normalizeArchiveUrl(historyUrl))?.objects ?? null;
						const events =
							stateByUrl.get(normalizeArchiveUrl(historyUrl))?.events ?? null;

						return (
							<div className="row compact" key={`${node.publicKey}:${historyUrl}`}>
								<div>
									<Link href={`/nodes/${encodeURIComponent(node.publicKey)}`}>
										<strong>{getNodeLabel(node)}</strong>
									</Link>
									<small>{historyUrl}</small>
								</div>
								<div className="metric">
									<strong>{archiveState?.status ?? 'No state record'}</strong>
									<small>{formatArchiveStateDetail(archiveState)}</small>
									{objects ? (
										<small>{formatObjectQueueSummary(objects)}</small>
									) : null}
									{events ? (
										<small>{formatLatestArchiveEvent(events)}</small>
									) : null}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</article>
	);
}

function formatLatestArchiveEvent(
	events: PublicHistoryArchiveObjectEvents
): string {
	const latest = events.events.at(0);
	if (latest === undefined) return 'No object events recorded';

	return `${latest.eventType} ${latest.workerStage ?? latest.objectType} at ${formatDateTime(latest.createdAt)}`;
}

function formatObjectQueueSummary(
	objects: PublicHistoryArchiveObjectQueue
): string {
	return `${formatInteger(objects.activeObjects)} scanning, ${formatInteger(
		objects.pendingObjects
	)} pending, ${formatInteger(objects.verifiedObjects)} verified, ${formatInteger(
		objects.failedObjects
	)} failed`;
}

function formatArchiveStateDetail(
	archiveState: PublicHistoryArchiveState | null
): string {
	if (archiveState === null) return 'Scanner has not persisted state yet';
	if (archiveState.metadata !== null) {
		return `ledger ${formatInteger(archiveState.metadata.stellarHistory.currentLedger)} observed ${formatDateTime(archiveState.observedAt)}`;
	}

	return archiveState.failure?.message ?? 'State fetch failed';
}

function normalizeArchiveUrl(historyUrl: string): string {
	return historyUrl.replace(/\/+$/, '').toLowerCase();
}

function OrganizationTomlEvidence({
	organization
}: {
	readonly organization: PublicOrganization;
}): React.JSX.Element {
	const stellarToml = organization.stellarToml;
	const tomlUrl =
		stellarToml?.url ??
		`https://${organization.homeDomain}/.well-known/stellar.toml`;

	return (
		<article className="panel detail-panel archive-metadata">
			<div className="panel-heading">
				<h2>TOML evidence</h2>
				<span className="muted-inline">{organization.tomlState}</span>
			</div>
			<details className="metadata-document" open={stellarToml !== null}>
				<summary>
					<span>stellar.toml</span>
					<a href={tomlUrl} rel="noopener noreferrer" target="_blank">
						{tomlUrl}
					</a>
				</summary>
				{stellarToml ? (
					<pre>{stellarToml.content}</pre>
				) : (
					<p className="muted-copy">
						No scanner-captured stellar.toml text is available yet.
					</p>
				)}
			</details>
		</article>
	);
}

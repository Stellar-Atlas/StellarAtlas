import Link from 'next/link';
import type {
	PublicKnownNode,
	PublicNetwork,
	PublicNode,
	PublicOrganization
} from '../../api/types';
import {
	getNodeTags,
	getOrganizationForNode,
	getOrganizationLabel
} from '../../domain/network';
import { formatBoolean } from '../../format/formatters';
import {
	formatNode24HourActive,
	formatNode24HourValidating,
	formatNode30DayActive,
	formatNode30DayValidating,
	type DisplayMetric
} from '../../domain/availability';
import { StatusTags } from '../status-tags';
import { NodeTrust } from './node-trust';
import { NodeArchiveActions } from './node-archive-actions';
import { LocalDateTime } from '../local-date-time';

interface NodeDetailProps {
	archiveEvidence: React.ReactNode;
	knownNode: PublicKnownNode;
	network: PublicNetwork;
	node: PublicNode | null;
	organization: PublicOrganization | null;
}

export function NodeDetail({
	archiveEvidence,
	knownNode,
	network,
	node,
	organization: routeOrganization
}: NodeDetailProps): React.JSX.Element {
	if (node === null) {
		return (
			<section className="detail-grid">
				<article className="panel detail-panel">
					<div className="panel-heading">
						<h2>Known public key</h2>
						<StatusTags
							tags={[{ label: 'public key only', tone: 'neutral' }]}
						/>
					</div>
					<dl className="details">
						<div>
							<dt>Public key</dt>
							<dd>{knownNode.publicKey}</dd>
						</div>
						<div>
							<dt>Date discovered</dt>
							<dd>
								<LocalDateTime dateTime={knownNode.dateDiscovered} />
							</dd>
						</div>
						<div>
							<dt>Last seen</dt>
							<dd>
								{knownNode.lastSeen ? (
									<LocalDateTime dateTime={knownNode.lastSeen} />
								) : (
									'Unavailable'
								)}
							</dd>
						</div>
						<div>
							<dt>Metadata</dt>
							<dd>No node snapshot is available.</dd>
						</div>
					</dl>
				</article>
				<NodeTrust network={network} knownNode={knownNode} node={null} />
				<div className="node-detail-wide">{archiveEvidence}</div>
			</section>
		);
	}

	const organization =
		routeOrganization ?? getOrganizationForNode(network, node);
	const recorded = (metric: DisplayMetric): DisplayMetric =>
		knownNode.current
			? metric
			: {
					...metric,
					value:
						metric.value === 'Collecting'
							? 'Insufficient history'
							: metric.value.replace(' now', ' at snapshot'),
					detail: metric.detail?.replace('Current scan', 'Recorded scan')
				};
	const active24Hours = recorded(formatNode24HourActive(node));
	const active30Days = recorded(formatNode30DayActive(node));
	const validating24Hours = recorded(formatNode24HourValidating(node));
	const validating30Days = recorded(formatNode30DayValidating(node));
	const nodeTags = getNodeTags(node);

	return (
		<section className="detail-grid">
			<article className="panel detail-panel">
				<div className="panel-heading">
					<h2>{knownNode.current ? 'Node status' : 'Recorded node status'}</h2>
					<StatusTags tags={nodeTags} />
				</div>
				<p className="muted-copy">
					Snapshot <LocalDateTime dateTime={node.dateUpdated} />
					{knownNode.current ? '' : ' · historical record'}
				</p>
				<dl className="details">
					<div>
						<dt>Public key</dt>
						<dd>{node.publicKey}</dd>
					</div>
					<div>
						<dt>Host</dt>
						<dd>{node.host ?? node.ip}</dd>
					</div>
					<div>
						<dt>Port</dt>
						<dd>{node.port}</dd>
					</div>
					<div>
						<dt>Version</dt>
						<dd>{node.versionStr ?? 'Unknown'}</dd>
					</div>
					<div>
						<dt>Ledger protocol</dt>
						<dd>{node.ledgerVersion ?? 'Unknown'}</dd>
					</div>
					<div>
						<dt>Validating</dt>
						<dd>{formatBoolean(node.isValidating)}</dd>
					</div>
					<div>
						<dt>Full validator</dt>
						<dd>{formatBoolean(node.isFullValidator)}</dd>
					</div>
					<div>
						<dt>Organization</dt>
						<dd>
							{organization ? (
								<Link
									href={`/organizations/${encodeURIComponent(organization.id)}`}
								>
									{getOrganizationLabel(organization)}
								</Link>
							) : (
								'Unassigned'
							)}
						</dd>
					</div>
				</dl>
			</article>
			<article className="panel detail-panel">
				<div className="panel-heading">
					<h2>
						{knownNode.current ? 'Availability' : 'Recorded availability'}
					</h2>
				</div>
				<dl className="details">
					<div>
						<dt>24H active</dt>
						<dd className={`metric-text ${active24Hours.tone}`}>
							{active24Hours.value}
						</dd>
					</div>
					<div>
						<dt>24H validating</dt>
						<dd className={`metric-text ${validating24Hours.tone}`}>
							{validating24Hours.value}
						</dd>
					</div>
					<div>
						<dt>30D active</dt>
						<dd>
							<span className={`metric-text ${active30Days.tone}`}>
								{active30Days.value}
							</span>
							{active30Days.detail ? (
								<small>{active30Days.detail}</small>
							) : null}
						</dd>
					</div>
					<div>
						<dt>30D validating</dt>
						<dd>
							<span className={`metric-text ${validating30Days.tone}`}>
								{validating30Days.value}
							</span>
							{validating30Days.detail ? (
								<small>{validating30Days.detail}</small>
							) : null}
						</dd>
					</div>
					<div>
						<dt>Country</dt>
						<dd>{node.geoData?.countryName ?? 'Unknown'}</dd>
					</div>
					<div>
						<dt>ISP</dt>
						<dd>{node.isp ?? 'Unknown'}</dd>
					</div>
					<div>
						<dt>History archive</dt>
						<dd>{node.historyUrl ?? 'None reported'}</dd>
					</div>
				</dl>
			</article>
			<NodeArchiveActions archiveUrl={node.historyUrl} />
			<NodeTrust network={network} knownNode={knownNode} node={node} />
			<div className="node-detail-wide">{archiveEvidence}</div>
		</section>
	);
}

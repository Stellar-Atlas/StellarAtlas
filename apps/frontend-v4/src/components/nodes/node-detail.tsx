import Link from 'next/link';
import type { PublicNetwork, PublicNode } from '../../api/types';
import {
	getNodeLabel,
	getNodeTags,
	getOrganizationForNode,
	getOrganizationLabel
} from '../../domain/network';
import { formatBoolean, formatPercent } from '../../format/formatters';
import { StatusTags } from '../status-tags';

interface NodeDetailProps {
	network: PublicNetwork;
	node: PublicNode;
}

export function NodeDetail({
	network,
	node
}: NodeDetailProps): React.JSX.Element {
	const organization = getOrganizationForNode(network, node);

	return (
		<section className="detail-grid">
			<article className="panel detail-panel">
				<div className="panel-heading">
					<h2>Node status</h2>
					<StatusTags tags={getNodeTags(node)} />
				</div>
				<dl className="details">
					<div><dt>Public key</dt><dd>{node.publicKey}</dd></div>
					<div><dt>Host</dt><dd>{node.host ?? node.ip}</dd></div>
					<div><dt>Port</dt><dd>{node.port}</dd></div>
					<div><dt>Version</dt><dd>{node.versionStr ?? 'Unknown'}</dd></div>
					<div><dt>Ledger protocol</dt><dd>{node.ledgerVersion ?? 'Unknown'}</dd></div>
					<div><dt>Validating</dt><dd>{formatBoolean(node.isValidating)}</dd></div>
					<div><dt>Full validator</dt><dd>{formatBoolean(node.isFullValidator)}</dd></div>
					<div>
						<dt>Organization</dt>
						<dd>
							{organization ? (
								<Link href={`/organizations/${encodeURIComponent(organization.id)}`}>
									{getOrganizationLabel(organization)}
								</Link>
							) : 'Unassigned'}
						</dd>
					</div>
				</dl>
			</article>
			<article className="panel detail-panel">
				<div className="panel-heading"><h2>Availability</h2></div>
				<dl className="details">
					<div>
						<dt>24H active</dt>
						<dd>{formatPercent(node.statistics.active24HoursPercentage)}</dd>
					</div>
					<div>
						<dt>24H validating</dt>
						<dd>{formatPercent(node.statistics.validating24HoursPercentage)}</dd>
					</div>
					<div>
						<dt>30D active</dt>
						<dd>{formatPercent(node.statistics.active30DaysPercentage)}</dd>
					</div>
					<div>
						<dt>30D validating</dt>
						<dd>{formatPercent(node.statistics.validating30DaysPercentage)}</dd>
					</div>
					<div><dt>Country</dt><dd>{node.geoData?.countryName ?? 'Unknown'}</dd></div>
					<div><dt>ISP</dt><dd>{node.isp ?? 'Unknown'}</dd></div>
					<div><dt>History archive</dt><dd>{node.historyUrl ?? 'None reported'}</dd></div>
				</dl>
			</article>
		</section>
	);
}

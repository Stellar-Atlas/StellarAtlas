import Link from 'next/link';
import type {
	PublicNetwork,
	PublicNode,
	PublicOrganization
} from '../../api/types';
import {
	getNodeLabel,
	getOrganizationLabel,
	getOrganizationTags
} from '../../domain/network';
import { formatBoolean, formatPercent } from '../../format/formatters';
import { StatusTags } from '../status-tags';

interface OrganizationDetailProps {
	network: PublicNetwork;
	organization: PublicOrganization;
}

export function OrganizationDetail({
	network,
	organization
}: OrganizationDetailProps): React.JSX.Element {
	const validators = organization.validators
		.map((publicKey): PublicNode | null =>
			network.nodes.find((node) => node.publicKey === publicKey) ?? null
		)
		.filter((node): node is PublicNode => node !== null);

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
					<div><dt>24H availability</dt><dd>{formatPercent(organization.subQuorum24HoursAvailability)}</dd></div>
					<div><dt>30D availability</dt><dd>{formatPercent(organization.subQuorum30DaysAvailability)}</dd></div>
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
								<small>{formatPercent(node.statistics.validating30DaysPercentage)}</small>
							</div>
						</div>
					))}
				</div>
			</article>
		</section>
	);
}

import { Fragment } from 'react';
import type { PublicKnownOrganizationRecordScope } from '@api/known-network-types';
import { LocalDateTime } from '../local-date-time';
import {
	organizationInventoryAvailability,
	organizationInventoryTags
} from './organization-inventory-model';
import styles from './organization-inventory.module.css';
import Link from 'next/link';
import type {
	PublicNetwork,
	PublicNode,
	PublicOrganization
} from '../../api/types';
import { getNodeLabel } from '../../domain/network';
import { formatNode30DayValidating } from '../../domain/availability';
import { formatBoolean } from '../../format/formatters';
import { StatusTags } from '../status-tags';
import { OrganizationTomlEvidence } from './organization-toml-evidence';

interface OrganizationDetailProps {
	archiveEvidence: React.ReactNode;
	network: Pick<PublicNetwork, 'nodes'>;
	organization: PublicOrganization;
	scope: PublicKnownOrganizationRecordScope;
	lastMeasurementAt: string | null;
}

export function OrganizationDetail({
	archiveEvidence,
	network,
	organization,
	scope,
	lastMeasurementAt
}: OrganizationDetailProps): React.JSX.Element {
	const validators = getOrganizationValidatorRows(
		network.nodes,
		organization.validators
	);
	const availability24Hours = organizationInventoryAvailability(
		organization,
		scope,
		'24h'
	);
	const availability30Days = organizationInventoryAvailability(
		organization,
		scope,
		'30d'
	);

	return (
		<section className={`detail-grid ${styles.detail}`}>
			<article className="panel detail-panel">
				<div className="panel-heading">
					<h2>
						{scope === 'archived'
							? 'Archived organization record'
							: 'Organization status'}
					</h2>
					<StatusTags tags={organizationInventoryTags(organization, scope)} />
				</div>
				<dl className="details">
					<div>
						<dt>Last measured</dt>
						<dd>
							{lastMeasurementAt ? (
								<LocalDateTime dateTime={lastMeasurementAt} />
							) : (
								'Not recorded'
							)}
						</dd>
					</div>
					<div>
						<dt>Home domain</dt>
						<dd>{organization.homeDomain}</dd>
					</div>
					<div>
						<dt>URL</dt>
						<dd>{organization.url ?? 'Not reported'}</dd>
					</div>
					<div>
						<dt>Public ledger API</dt>
						<dd>{organization.horizonUrl ?? 'Not reported'}</dd>
					</div>
					<div>
						<dt>Validators</dt>
						<dd>{organization.validators.length}</dd>
					</div>
					<div>
						<dt>
							{scope === 'archived'
								? 'Recorded quorum path'
								: 'Quorum path available'}
						</dt>
						<dd>
							{scope === 'archived'
								? `${formatBoolean(organization.subQuorumAvailable)} (historical snapshot)`
								: formatBoolean(organization.subQuorumAvailable)}
						</dd>
					</div>
					<div>
						<dt>24H availability</dt>
						<dd>
							<span className={`metric-text ${availability24Hours.tone}`}>
								{availability24Hours.value}
							</span>
							{availability24Hours.detail ? (
								<small>{availability24Hours.detail}</small>
							) : null}
						</dd>
					</div>
					<div>
						<dt>30D availability</dt>
						<dd>
							<span className={`metric-text ${availability30Days.tone}`}>
								{availability30Days.value}
							</span>
							{availability30Days.detail ? (
								<small>{availability30Days.detail}</small>
							) : null}
						</dd>
					</div>
				</dl>
			</article>
			<article className="panel detail-panel">
				<div className="panel-heading">
					<h2>Validators</h2>
				</div>
				<div className="table">
					{validators.map(({ node, publicKey }) => (
						<div className="row compact" key={publicKey}>
							<div>
								<Link href={`/nodes/${encodeURIComponent(publicKey)}`}>
									<strong>
										{node ? getNodeLabel(node) : publicKey.slice(0, 12)}
									</strong>
								</Link>
								<small>{node?.versionStr ?? publicKey}</small>
							</div>
							<div className="metric">
								<strong>
									{node === null
										? 'Snapshot unavailable'
										: node.isValidating
											? 'Validating'
											: 'Not validating'}
								</strong>
								<small>
									{node
										? formatNode30DayValidating(node).value
										: 'No current node record'}
								</small>
							</div>
						</div>
					))}
					{validators.length === 0 ? (
						<p className="muted-copy">
							No validator public keys are reported for this organization.
						</p>
					) : null}
				</div>
			</article>
			<Fragment key={`archive-evidence:${organization.id}`}>
				{archiveEvidence}
			</Fragment>
			<OrganizationTomlEvidence organization={organization} />
		</section>
	);
}

export function getOrganizationValidatorRows(
	nodes: readonly PublicNode[],
	publicKeys: readonly string[]
): readonly {
	readonly node: PublicNode | null;
	readonly publicKey: string;
}[] {
	return publicKeys.map((publicKey) => ({
		node: nodes.find((node) => node.publicKey === publicKey) ?? null,
		publicKey
	}));
}

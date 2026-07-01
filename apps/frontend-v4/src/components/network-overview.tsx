import type {
	PublicNetwork,
	PublicNode,
	PublicOrganization
} from '../api/types';
import {
	formatBoolean,
	formatDateTime,
	formatInteger,
	formatPercent
} from '../format/formatters';

interface StatCard {
	label: string;
	value: string;
	detail: string;
	tone?: 'good' | 'warning';
}

const getNodeLabel = (node: PublicNode): string =>
	node.alias ?? node.name ?? node.host ?? node.publicKey.slice(0, 10);

const getOrganizationLabel = (organization: PublicOrganization): string =>
	organization.name ?? organization.dba ?? organization.homeDomain;

const countByVersion = (nodes: PublicNode[]): Map<string, number> => {
	const counts = new Map<string, number>();

	for (const node of nodes) {
		const label = node.versionStr ?? 'Unknown';
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}

	return counts;
};

const getTopVersions = (nodes: PublicNode[]): [string, number][] =>
	Array.from(countByVersion(nodes).entries())
		.sort((left, right) => right[1] - left[1])
		.slice(0, 5);

const getValidatorRiskNodes = (nodes: PublicNode[]): PublicNode[] =>
	nodes
		.filter((node) =>
			node.isValidator &&
			(node.connectivityError ||
				node.historyArchiveHasError ||
				node.stellarCoreVersionBehind ||
				!node.isValidating)
		)
		.sort((left, right) => right.index - left.index)
		.slice(0, 8);

const getTopOrganizations = (
	organizations: PublicOrganization[]
): PublicOrganization[] =>
	organizations
		.toSorted(
			(left, right) =>
				right.validators.length - left.validators.length ||
				getOrganizationLabel(left).localeCompare(getOrganizationLabel(right))
		)
		.slice(0, 8);

const buildStats = (network: PublicNetwork): StatCard[] => [
	{
		label: 'Connectable nodes',
		value: formatInteger(network.statistics.nrOfConnectableNodes),
		detail: `${formatInteger(network.nodes.length)} observed nodes`
	},
	{
		label: 'Validator nodes',
		value: formatInteger(network.statistics.nrOfActiveValidators),
		detail: `${formatInteger(network.statistics.transitiveQuorumSetSize)} in transitive quorum set`
	},
	{
		label: 'Full validators',
		value: formatInteger(network.statistics.nrOfActiveFullValidators),
		detail: `${formatInteger(network.statistics.topTierSize)} top tier validators`
	},
	{
		label: 'Organizations',
		value: formatInteger(network.statistics.nrOfActiveOrganizations),
		detail: `${formatInteger(network.organizations.length)} discovered organizations`
	},
	{
		label: 'Quorum intersection',
		value: formatBoolean(network.statistics.hasQuorumIntersection),
		detail: `${formatInteger(network.statistics.minBlockingSetSize)} node minimum blocking set`,
		tone: network.statistics.hasQuorumIntersection ? 'good' : 'warning'
	},
	{
		label: 'Protocol',
		value: network.maxLedgerVersion?.toString() ?? 'Unknown',
		detail: network.stellarCoreVersion ?? 'No dominant core version'
	}
];

interface NetworkOverviewProps {
	network: PublicNetwork;
}

export function NetworkOverview({ network }: NetworkOverviewProps): React.JSX.Element {
	const topVersions = getTopVersions(network.nodes);
	const riskNodes = getValidatorRiskNodes(network.nodes);
	const topOrganizations = getTopOrganizations(network.organizations);

	return (
		<main className="shell">
			<header className="topbar">
				<div>
					<p className="eyebrow">{network.name}</p>
					<h1>Network operations</h1>
				</div>
				<div className="timestamp">
					<span>Ledger {network.latestLedger}</span>
					<strong>{formatDateTime(network.time)}</strong>
				</div>
			</header>

			<section className="stats-grid" aria-label="Network statistics">
				{buildStats(network).map((stat) => (
					<article className={`stat-card ${stat.tone ?? ''}`} key={stat.label}>
						<span>{stat.label}</span>
						<strong>{stat.value}</strong>
						<small>{stat.detail}</small>
					</article>
				))}
			</section>

			<section className="content-grid">
				<article className="panel">
					<div className="panel-heading">
						<h2>Validator attention</h2>
						<span>{formatInteger(riskNodes.length)} shown</span>
					</div>
					<div className="table">
						{riskNodes.map((node) => (
							<div className="row" key={node.publicKey}>
								<div>
									<strong>{getNodeLabel(node)}</strong>
									<small>{node.homeDomain ?? node.publicKey}</small>
								</div>
								<div className="tags">
									{!node.isValidating && <span>not validating</span>}
									{node.historyArchiveHasError && <span>archive</span>}
									{node.connectivityError && <span>connectivity</span>}
									{node.stellarCoreVersionBehind && <span>version</span>}
								</div>
							</div>
						))}
					</div>
				</article>

				<article className="panel">
					<div className="panel-heading">
						<h2>Organizations</h2>
						<span>{formatInteger(network.organizations.length)} total</span>
					</div>
					<div className="table">
						{topOrganizations.map((organization) => (
							<div className="row compact" key={organization.id}>
								<div>
									<strong>{getOrganizationLabel(organization)}</strong>
									<small>{organization.homeDomain}</small>
								</div>
								<div className="metric">
									<strong>{formatInteger(organization.validators.length)}</strong>
									<small>{formatPercent(organization.subQuorum30DaysAvailability)}</small>
								</div>
							</div>
						))}
					</div>
				</article>

				<article className="panel">
					<div className="panel-heading">
						<h2>Core versions</h2>
						<span>Observed software</span>
					</div>
					<div className="version-list">
						{topVersions.map(([version, count]) => (
							<div className="version-row" key={version}>
								<span>{version}</span>
								<meter min={0} max={network.nodes.length} value={count} />
								<strong>{formatInteger(count)}</strong>
							</div>
						))}
					</div>
				</article>
			</section>
		</main>
	);
}

import Link from 'next/link';
import type { PublicNetwork, PublicNode } from '../api/types';
import { getRiskNodes, getTopOrganizations } from '../domain/network';
import { formatBoolean, formatInteger, formatPercent } from '../format/formatters';
import { NetworkGraph } from './graph/network-graph';
import { PageHeading } from './layout/page-heading';
import { StatCard } from './stat-card';

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

interface NetworkOverviewProps {
	network: PublicNetwork;
}

export function NetworkOverview({ network }: NetworkOverviewProps): React.JSX.Element {
	const topVersions = getTopVersions(network.nodes);
	const riskNodes = getRiskNodes(network.nodes).slice(0, 8);
	const topOrganizations = getTopOrganizations(network.organizations).slice(0, 8);

	return (
		<main className="shell">
			<PageHeading
				description="Live network topology, validator health, organization coverage, and observed Stellar Core versions."
				eyebrow={network.name}
				title="Network operations"
			/>

			<section className="stats-grid" aria-label="Network statistics">
				<StatCard
					detail={`${formatInteger(network.nodes.length)} observed nodes`}
					label="Connectable nodes"
					value={formatInteger(network.statistics.nrOfConnectableNodes)}
				/>
				<StatCard
					detail={`${formatInteger(network.statistics.transitiveQuorumSetSize)} in transitive quorum set`}
					label="Validator nodes"
					value={formatInteger(network.statistics.nrOfActiveValidators)}
				/>
				<StatCard
					detail={`${formatInteger(network.statistics.topTierSize)} top tier validators`}
					label="Full validators"
					value={formatInteger(network.statistics.nrOfActiveFullValidators)}
				/>
				<StatCard
					detail={`${formatInteger(network.organizations.length)} discovered organizations`}
					label="Organizations"
					value={formatInteger(network.statistics.nrOfActiveOrganizations)}
				/>
				<StatCard
					detail={`${formatInteger(network.statistics.minBlockingSetSize)} node blocking set`}
					label="Quorum intersection"
					tone={network.statistics.hasQuorumIntersection ? 'good' : 'danger'}
					value={formatBoolean(network.statistics.hasQuorumIntersection)}
				/>
				<StatCard
					detail={network.stellarCoreVersion ?? 'No dominant core version'}
					label="Protocol"
					value={network.maxLedgerVersion?.toString() ?? 'Unknown'}
				/>
			</section>

			<NetworkGraph network={network} />

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
									<Link href={`/nodes/${encodeURIComponent(node.publicKey)}`}>
										<strong>{node.alias ?? node.name ?? node.publicKey.slice(0, 12)}</strong>
									</Link>
									<small>{node.homeDomain ?? node.publicKey}</small>
								</div>
								<div className="tags">
									{!node.isValidating && <span className="tag danger">not validating</span>}
									{node.historyArchiveHasError && <span className="tag warning">archive</span>}
									{node.connectivityError && <span className="tag danger">connectivity</span>}
									{node.stellarCoreVersionBehind && <span className="tag warning">version</span>}
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
									<Link href={`/organizations/${encodeURIComponent(organization.id)}`}>
										<strong>{organization.name ?? organization.dba ?? organization.homeDomain}</strong>
									</Link>
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

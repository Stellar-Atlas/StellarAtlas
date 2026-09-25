import Link from 'next/link';
import type { PublicNetwork } from '../api/types';
import { formatOrganization30DayAvailability } from '../domain/availability';
import { getNodeLabel, getOrganizationLabel } from '../domain/network';
import {
	getOverviewAttention,
	getOverviewOrganizations,
	getOverviewVersions,
	type OverviewOrganization
} from '../domain/network-overview-model';
import { formatInteger } from '../format/formatters';
import { PageHeading } from './layout/page-heading';
import styles from './network-overview.module.css';

function OrganizationRows({
	rows
}: {
	rows: readonly OverviewOrganization[];
}): React.JSX.Element {
	return (
		<div className={styles.tableWrap}>
			<table className={styles.table}>
				<thead>
					<tr>
						<th scope="col">Organization</th>
						<th scope="col">Validating</th>
						<th scope="col">Quorum path</th>
						<th scope="col">30-day availability</th>
					</tr>
				</thead>
				<tbody>
					{rows.map(({ organization, validating, validators }) => (
						<tr key={organization.id}>
							<td>
								<Link
									href={`/organizations/${encodeURIComponent(organization.id)}`}
									prefetch={false}
								>
									<strong>{getOrganizationLabel(organization)}</strong>
								</Link>
								<small>{organization.homeDomain}</small>
							</td>
							<td>
								{validating} / {validators}
								<small>observed validators</small>
							</td>
							<td
								className={
									organization.subQuorumAvailable ? styles.good : styles.warning
								}
							>
								{organization.subQuorumAvailable ? 'Available' : 'Unavailable'}
							</td>
							<td>{formatOrganization30DayAvailability(organization).value}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function NetworkOverview({
	network
}: {
	network: PublicNetwork;
}): React.JSX.Element {
	const validators = network.nodes.filter((node) => node.isValidator);
	const validating = validators.filter((node) => node.isValidating);
	const organizations = getOverviewOrganizations(network);
	const participating = organizations.filter((row) => row.validating > 0);
	const other = organizations.filter((row) => row.validating === 0);
	const attention = getOverviewAttention(network.nodes);
	const versions = getOverviewVersions(network.nodes);
	const roots = new Set(
		validators.flatMap((node) => (node.historyUrl ? [node.historyUrl] : []))
	);
	const statistics = network.statistics;
	return (
		<main
			className={`shell ${styles.overview}`}
			data-network-scope={network.scope}
		>
			<PageHeading
				title="Network overview"
				eyebrow={network.name}
				description="Who is validating, which operators need attention, and how the observed quorum is connected."
				scopeContext={{ kind: 'network', scope: network.scope }}
			/>
			<section className={styles.metrics} aria-label="Current network snapshot">
				<Link href="/nodes" prefetch={false}>
					<span>Validating nodes</span>
					<strong>{formatInteger(validating.length)}</strong>
					<small>
						of {formatInteger(validators.length)} observed validators →
					</small>
				</Link>
				<Link href="/organizations" prefetch={false}>
					<span>Participating organizations</span>
					<strong>{formatInteger(participating.length)}</strong>
					<small>with a validating node in this snapshot →</small>
				</Link>
				<Link href="/archives" prefetch={false}>
					<span>Validator archive sources</span>
					<strong>{formatInteger(roots.size)}</strong>
					<small>distinct advertised URLs; inspect coverage →</small>
				</Link>
				<Link href="#validator-attention">
					<span>Validators needing attention</span>
					<strong>{formatInteger(attention.length)}</strong>
					<small>validation, connection, or software findings ↓</small>
				</Link>
			</section>
			<nav className={styles.links} aria-label="Network tools">
				<Link href="/">Inspect trust graph →</Link>
				<Link href="/archives">Compare archive coverage →</Link>
				<Link href="/explorer">Explore ledger activity →</Link>
				<Link href="/status">Check service and ingestion status →</Link>
			</nav>
			<div className={styles.columns}>
				<section
					className={styles.panel}
					aria-label="Organization participation"
				>
					<div className={styles.heading}>
						<h2>Organizations validating now</h2>
						<Link href="/organizations" prefetch={false}>
							Full organization directory →
						</Link>
					</div>
					<p className={styles.note}>
						All {participating.length} organizations with observed validation,
						alphabetically. Availability measures the organization’s quorum
						path—not archive completeness.
					</p>
					{participating.length ? (
						<OrganizationRows rows={participating} />
					) : (
						<p className={styles.note}>
							No validating organization is recorded in this snapshot.
						</p>
					)}
					{other.length > 0 && (
						<details className={styles.other}>
							<summary>
								{other.length} other observed organizations · no validating
								nodes in this snapshot
							</summary>
							<OrganizationRows rows={other} />
						</details>
					)}
				</section>
				<div>
					<section
						className={styles.panel}
						id="validator-attention"
						aria-label="Validator attention"
					>
						<div className={styles.heading}>
							<h2>Validator attention</h2>
							<span>{attention.length} total</span>
						</div>
						{attention.length ? (
							<ul className={styles.attention}>
								{attention.slice(0, 8).map((node) => (
									<li key={node.publicKey}>
										<Link
											href={`/nodes/${encodeURIComponent(node.publicKey)}`}
											prefetch={false}
										>
											<strong>{getNodeLabel(node)} →</strong>
										</Link>
										<p>
											{[
												!node.isValidating
													? 'No validation observed in this scan'
													: null,
												node.connectivityError
													? 'Connection attempt failed'
													: null,
												node.stellarCoreVersionBehind
													? 'Software behind configured baseline'
													: null
											]
												.filter(Boolean)
												.join(' · ')}
										</p>
									</li>
								))}
							</ul>
						) : (
							<p className={`${styles.note} ${styles.good}`}>
								No validation, connection, or software-baseline findings in this
								snapshot.
							</p>
						)}
						<p className={styles.note}>
							{attention.length > 8 ? `Showing 8 of ${attention.length}. ` : ''}
							These are network-scan findings.{' '}
							<Link href="/archives">Archive file findings are separate.</Link>
						</p>
					</section>
					<section
						className={styles.panel}
						aria-label="Observed quorum analysis"
					>
						<div className={styles.heading}>
							<h2>Observed quorum</h2>
							<Link href="/">Inspect graph →</Link>
						</div>
						<dl className={styles.analysis}>
							<dt>Quorum intersection</dt>
							<dd>
								{statistics.hasTransitiveQuorumSet
									? statistics.hasQuorumIntersection
										? 'Yes'
										: 'No'
									: 'Not evaluated'}
							</dd>
							<dt>Top-tier validators</dt>
							<dd>{formatInteger(statistics.topTierSize)}</dd>
							<dt>Top-tier organizations</dt>
							<dd>{formatInteger(statistics.topTierOrgsSize)}</dd>
							<dt>Smallest blocking set</dt>
							<dd>
								{statistics.hasTransitiveQuorumSet
									? `${statistics.minBlockingSetSize} nodes`
									: 'Not evaluated'}
							</dd>
							<dt>Organization blocking set</dt>
							<dd>
								{statistics.hasTransitiveQuorumSet
									? `${statistics.minBlockingSetOrgsSize} organizations`
									: 'Not evaluated'}
							</dd>
						</dl>
						<p className={styles.note}>
							Blocking sets are groups whose unavailability can halt consensus
							under the observed quorum configuration. They are not a count of
							failed nodes.
						</p>
					</section>
					<section className={styles.panel} aria-label="Validator software">
						<div className={styles.heading}>
							<h2>Validator software</h2>
							<span>{validating.length} validating nodes</span>
						</div>
						<ul className={styles.versions}>
							{versions.map(([version, count]) => (
								<li key={version}>
									<span>{version}</span>
									<strong>{count}</strong>
									<meter
										aria-label={`${version}: ${count} validating nodes`}
										min={0}
										max={Math.max(1, validating.length)}
										value={count}
									/>
								</li>
							))}
						</ul>
						<p className={styles.note}>
							Observed software versions, not the network’s activated protocol.
							Snapshot ledger {formatInteger(Number(network.latestLedger))}.
						</p>
					</section>
				</div>
			</div>
		</main>
	);
}

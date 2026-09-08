import Link from 'next/link';
import type {
	PublicKnownNode,
	PublicNetwork,
	PublicNode
} from '../../api/types';
import { getOrganizationLabel } from '../../domain/network';
import { LocalDateTime } from '../local-date-time';
import { NetworkGraphCanvas } from '../graph/network-graph-canvas';
import {
	buildNodeTrust,
	trustOrganizations,
	type NodeTrustMember
} from './node-trust-model';

export function NodeTrust({
	network,
	knownNode,
	node
}: {
	readonly network: PublicNetwork;
	readonly knownNode: PublicKnownNode;
	readonly node: PublicNode | null;
}): React.JSX.Element {
	const model = buildNodeTrust(network, knownNode.publicKey, node);
	return (
		<section
			className="node-detail-wide node-trust"
			aria-label="Quorum trust relationships"
		>
			<div className="node-trust-columns">
				<TrustDirection
					title="Trusts"
					members={model.trusts}
					available={model.quorumAvailable}
				>
					This node’s reported quorum set, including nested sets.{' '}
					{node ? (
						<>
							Snapshot <LocalDateTime dateTime={node.dateUpdated} />
							{knownNode.current ? '.' : ' (historical).'}
						</>
					) : null}
				</TrustDirection>
				<TrustDirection title="Trusted by" members={model.trustedBy} available>
					Nodes whose quorum sets include this key. Network snapshot{' '}
					<LocalDateTime dateTime={network.time} />.
				</TrustDirection>
			</div>
			{model.graph.edges.length > 0 ? (
				<div className="node-trust-graph">
					<NetworkGraphCanvas model={model.graph} />
					<p className="muted-copy">
						Only relationships involving this node are drawn. Direction is
						listed above; public keys without node metadata remain in the lists.
						Quorum membership is not evidence of SCP signature verification.
					</p>
				</div>
			) : null}
		</section>
	);
}

function TrustDirection({
	title,
	members,
	available,
	children
}: {
	readonly title: string;
	readonly members: readonly NodeTrustMember[];
	readonly available: boolean;
	readonly children: React.ReactNode;
}): React.JSX.Element {
	const organizations = trustOrganizations(members);
	return (
		<article className="panel detail-panel node-trust-direction">
			<div className="panel-heading">
				<h2>{title}</h2>
				<span>
					{available
						? `${members.length} keys · ${organizations.length} organizations`
						: 'Unavailable'}
				</span>
			</div>
			<p className="muted-copy">{children}</p>
			{!available ? (
				<p>No quorum set is available for this node.</p>
			) : (
				<>
					<h3>Validators / nodes</h3>
					{members.length === 0 ? (
						<p>No references in this snapshot.</p>
					) : (
						<ul className="node-trust-members">
							{members.map((member) => (
								<li key={member.publicKey}>
									<Link
										href={`/nodes/${encodeURIComponent(member.publicKey)}`}
										title={member.publicKey}
									>
										{member.label}
									</Link>
									<small>
										{member.organization
											? getOrganizationLabel(member.organization)
											: 'Organization unknown'}{' '}
										·{' '}
										{member.node === null
											? 'public key only'
											: member.node.isValidator
												? 'validator'
												: 'node'}
									</small>
								</li>
							))}
						</ul>
					)}
					<h3>Organizations</h3>
					{organizations.length === 0 ? (
						<p>No organization attribution is available.</p>
					) : (
						<ul className="node-trust-organizations">
							{organizations.map((organization) => (
								<li key={organization.id}>
									<Link
										href={`/organizations/${encodeURIComponent(organization.id)}`}
									>
										{getOrganizationLabel(organization)}
									</Link>
								</li>
							))}
						</ul>
					)}
				</>
			)}
		</article>
	);
}

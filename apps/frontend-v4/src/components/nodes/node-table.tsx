'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { PublicKnownNode, PublicNetwork, PublicNode } from '../../api/types';
import {
	getNodeLabel,
	getNodeTags,
	getOrganizationForNode,
	getOrganizationLabel
} from '../../domain/network';
import { formatNode24HourValidating, formatNode30DayValidating } from '../../domain/availability';
import { StatusTags } from '../status-tags';

type NodeFilter = 'all' | 'validators' | 'listeners' | 'warnings';

interface NodeTableProps {
	network: PublicNetwork;
	nodes: readonly PublicKnownNode[];
}

const normalize = (value: string): string => value.toLowerCase();

const getKnownNodeLabel = (knownNode: PublicKnownNode): string =>
	knownNode.node ? getNodeLabel(knownNode.node) : knownNode.publicKey.slice(0, 12);

const filterNodes = (
	nodes: readonly PublicKnownNode[],
	filter: NodeFilter,
	query: string,
	network: PublicNetwork
): PublicKnownNode[] => {
	const normalizedQuery = normalize(query.trim());

	return nodes
		.filter((knownNode) => {
			const node = knownNode.node;
			if (filter === 'validators' && (node === null || !node.isValidator))
				return false;
			if (
				filter === 'listeners' &&
				(node === null || node.isValidator || !node.active)
			)
				return false;
			if (
				filter === 'warnings' &&
				(node === null ||
					(!node.historyArchiveHasError &&
						!node.connectivityError &&
						!node.stellarCoreVersionBehind &&
						node.isValidating))
			) return false;

			if (normalizedQuery.length === 0) return true;
			const organization = node ? getOrganizationForNode(network, node) : null;
			const haystack = normalize([
				getKnownNodeLabel(knownNode),
				knownNode.publicKey,
				node?.homeDomain ?? '',
				node?.host ?? '',
				node?.ip ?? '',
				organization ? getOrganizationLabel(organization) : ''
			].join(' '));
			return haystack.includes(normalizedQuery);
		})
		.toSorted((left, right) => {
			const leftNode = left.node;
			const rightNode = right.node;
			if ((leftNode?.isValidator ?? false) !== (rightNode?.isValidator ?? false)) {
				return leftNode?.isValidator ? -1 : 1;
			}
			if (left.metadataState !== right.metadataState) {
				return left.metadataState === 'snapshot' ? -1 : 1;
			}
			return (
				(rightNode?.index ?? -1) - (leftNode?.index ?? -1) ||
				getKnownNodeLabel(left).localeCompare(getKnownNodeLabel(right))
			);
		});
};

export function NodeTable({
	network,
	nodes
}: NodeTableProps): React.JSX.Element {
	const [filter, setFilter] = useState<NodeFilter>('all');
	const [query, setQuery] = useState('');
	const visibleNodes = useMemo(
		() => filterNodes(nodes, filter, query, network),
		[filter, network, nodes, query]
	);

	return (
		<section className="panel data-panel">
			<div className="panel-heading controls-heading">
				<div>
					<h2>Nodes</h2>
					<span>{visibleNodes.length} shown from {nodes.length}</span>
				</div>
				<div className="table-controls">
					<input
						aria-label="Filter nodes"
						onChange={(event) => setQuery(event.currentTarget.value)}
						placeholder="Filter nodes"
						value={query}
					/>
					<div className="segmented">
						{(['all', 'validators', 'listeners', 'warnings'] as NodeFilter[]).map(
							(option) => (
								<button
									className={filter === option ? 'active' : ''}
									key={option}
									onClick={() => setFilter(option)}
									type="button"
								>
									{option}
								</button>
							)
						)}
					</div>
				</div>
			</div>
			<div className="responsive-table">
				<table>
					<thead>
						<tr>
							<th>Node</th>
							<th>Organization</th>
							<th>Version</th>
							<th>Country</th>
							<th>24H validating</th>
							<th>30D signal</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						{visibleNodes.map((knownNode) => {
							const node = knownNode.node;
							const organization = node ? getOrganizationForNode(network, node) : null;
							const validating24Hours = node ? formatNode24HourValidating(node) : null;
							const validating30Days = node ? formatNode30DayValidating(node) : null;
							return (
								<tr key={knownNode.publicKey}>
									<td>
										<Link href={`/nodes/${encodeURIComponent(knownNode.publicKey)}`}>
											<strong>{getKnownNodeLabel(knownNode)}</strong>
										</Link>
										<small>{node ? node.host ?? node.ip : 'Public key only'}</small>
									</td>
									<td>
										{organization ? (
											<Link href={`/organizations/${encodeURIComponent(organization.id)}`}>
												{getOrganizationLabel(organization)}
											</Link>
										) : (
											<span className="muted">Unassigned</span>
										)}
									</td>
									<td>{node?.versionStr ?? 'Unknown'}</td>
									<td>{node?.geoData?.countryName ?? 'Unknown'}</td>
									<td>
										<span className={`metric-text ${validating24Hours?.tone ?? 'muted'}`}>
											{validating24Hours?.value ?? 'No snapshot'}
										</span>
									</td>
									<td>
										<span className={`metric-text ${validating30Days?.tone ?? 'muted'}`}>
											{validating30Days?.value ?? 'Unavailable'}
										</span>
										{validating30Days?.detail ? <small>{validating30Days.detail}</small> : null}
									</td>
									<td>
										<StatusTags
											tags={
												node
													? [
															...getNodeTags(node),
															...(!knownNode.current
																? [{ label: 'archived', tone: 'neutral' as const }]
																: [])
														]
													: [{ label: 'public key only', tone: 'neutral' }]
											}
										/>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</section>
	);
}

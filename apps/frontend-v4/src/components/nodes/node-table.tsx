'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { PublicNetwork, PublicNode } from '../../api/types';
import {
	getNodeLabel,
	getNodeTags,
	getOrganizationForNode,
	getOrganizationLabel
} from '../../domain/network';
import { formatPercent } from '../../format/formatters';
import { StatusTags } from '../status-tags';

type NodeFilter = 'all' | 'validators' | 'listeners' | 'warnings';

interface NodeTableProps {
	network: PublicNetwork;
	nodes: PublicNode[];
}

const normalize = (value: string): string => value.toLowerCase();

const filterNodes = (
	nodes: PublicNode[],
	filter: NodeFilter,
	query: string,
	network: PublicNetwork
): PublicNode[] => {
	const normalizedQuery = normalize(query.trim());

	return nodes
		.filter((node) => {
			if (filter === 'validators' && !node.isValidator) return false;
			if (filter === 'listeners' && (node.isValidator || !node.active)) return false;
			if (
				filter === 'warnings' &&
				!node.historyArchiveHasError &&
				!node.connectivityError &&
				!node.stellarCoreVersionBehind &&
				node.isValidating
			) return false;

			if (normalizedQuery.length === 0) return true;
			const organization = getOrganizationForNode(network, node);
			const haystack = normalize([
				getNodeLabel(node),
				node.publicKey,
				node.homeDomain ?? '',
				node.host ?? '',
				node.ip,
				organization ? getOrganizationLabel(organization) : ''
			].join(' '));
			return haystack.includes(normalizedQuery);
		})
		.toSorted((left, right) => {
			if (left.isValidator !== right.isValidator) return left.isValidator ? -1 : 1;
			return right.index - left.index || getNodeLabel(left).localeCompare(getNodeLabel(right));
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
							<th>30D validating</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						{visibleNodes.map((node) => {
							const organization = getOrganizationForNode(network, node);
							return (
								<tr key={node.publicKey}>
									<td>
										<Link href={`/nodes/${encodeURIComponent(node.publicKey)}`}>
											<strong>{getNodeLabel(node)}</strong>
										</Link>
										<small>{node.host ?? node.ip}</small>
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
									<td>{node.versionStr ?? 'Unknown'}</td>
									<td>{node.geoData?.countryName ?? 'Unknown'}</td>
									<td>{formatPercent(node.statistics.validating30DaysPercentage)}</td>
									<td><StatusTags tags={getNodeTags(node)} /></td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</section>
	);
}

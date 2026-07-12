'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { NetworkV1 } from 'shared';
import type {
	PublicKnownNetworkPage,
	PublicKnownNodeListItem
} from '../../api/known-network-types';
import {
	getNodeLabel,
	getNodeTags,
	getOrganizationForNode,
	getOrganizationLabel
} from '../../domain/network';
import {
	formatNode24HourValidating,
	formatNode30DayValidating
} from '../../domain/availability';
import { StatusTags } from '../status-tags';
import {
	defaultNodeInventoryFilter,
	isNodeInventoryFilter,
	nodeInventoryFilterLabels,
	nodeInventoryFilterOrder,
	type NodeInventoryFilter
} from '../../domain/known-network-scopes';

interface NodeTableProps {
	network: NetworkV1;
	nodes: readonly PublicKnownNodeListItem[];
	page: PublicKnownNetworkPage;
	query: string;
	scope: NodeInventoryFilter;
	selectedPublicKey?: string;
	totalCount?: number;
}

const getKnownNodeLabel = (knownNode: PublicKnownNodeListItem): string =>
	knownNode.node
		? getNodeLabel(knownNode.node)
		: knownNode.publicKey.slice(0, 12);

export function NodeTable({
	network,
	nodes,
	page,
	query,
	scope,
	selectedPublicKey = '',
	totalCount = nodes.length
}: NodeTableProps): React.JSX.Element {
	const router = useRouter();
	const [input, setInput] = useState(query);
	const pageNumber = Math.floor(page.offset / page.limit) + 1;
	const pageCount = Math.max(1, Math.ceil(page.total / page.limit));
	const navigate = (
		nextScope: NodeInventoryFilter,
		nextQuery: string,
		nextPage: number
	): void => {
		const params = new URLSearchParams();
		params.set('scope', nextScope);
		if (nextQuery.trim()) params.set('q', nextQuery.trim());
		if (nextPage > 1) params.set('page', nextPage.toString());
		router.push(`/nodes?${params.toString()}`);
	};

	return (
		<section className="panel data-panel">
			<div className="panel-heading controls-heading">
				<div>
					<h2>Nodes</h2>
					<span>
						Showing {formatVisibleRange(page.offset, nodes.length, page.total)}{' '}
						from {totalCount} known
					</span>
				</div>
				<div className="table-controls">
					<input
						aria-label="Filter nodes"
						onChange={(event) => setInput(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') navigate(scope, input, 1);
						}}
						placeholder="Filter nodes"
						value={input}
					/>
					<select
						aria-label="Node inventory scope"
						onChange={(event) => {
							const value = event.currentTarget.value;
							if (isNodeInventoryFilter(value)) navigate(value, input, 1);
						}}
						value={scope}
					>
						{nodeInventoryFilterOrder.map((option) => (
							<option key={option} value={option}>
								{nodeInventoryFilterLabels[option]}
							</option>
						))}
					</select>
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
						{nodes.map((knownNode) => {
							const node = knownNode.node;
							const organization = node
								? getOrganizationForNode(network, node)
								: null;
							const validating24Hours = node
								? formatNode24HourValidating(node)
								: null;
							const validating30Days = node
								? formatNode30DayValidating(node)
								: null;
							return (
								<tr
									className={
										knownNode.publicKey === selectedPublicKey
											? 'selected-row'
											: undefined
									}
									key={knownNode.publicKey}
								>
									<td>
										<Link
											href={`/nodes/${encodeURIComponent(knownNode.publicKey)}`}
										>
											<strong>{getKnownNodeLabel(knownNode)}</strong>
										</Link>
										<small>
											{node ? (node.host ?? node.ip) : 'Public key only'}
										</small>
									</td>
									<td>
										{organization ? (
											<Link
												href={`/organizations/${encodeURIComponent(organization.id)}`}
											>
												{getOrganizationLabel(organization)}
											</Link>
										) : (
											<span className="muted">Unassigned</span>
										)}
									</td>
									<td>{node?.versionStr ?? 'Unknown'}</td>
									<td>{node?.geoData?.countryName ?? 'Unknown'}</td>
									<td>
										<span
											className={`metric-text ${validating24Hours?.tone ?? 'muted'}`}
										>
											{validating24Hours?.value ?? 'No snapshot'}
										</span>
									</td>
									<td>
										<span
											className={`metric-text ${validating30Days?.tone ?? 'muted'}`}
										>
											{validating30Days?.value ?? 'Unavailable'}
										</span>
										{validating30Days?.detail ? (
											<small>{validating30Days.detail}</small>
										) : null}
									</td>
									<td>
										<StatusTags
											tags={
												node
													? [
															...getNodeTags(node),
															...(knownNode.scope === 'archived'
																? [
																		{
																			label: 'archived',
																			tone: 'neutral' as const
																		}
																	]
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
			<div className="table-pagination">
				<button
					disabled={pageNumber <= 1}
					onClick={() => navigate(scope, query, pageNumber - 1)}
					type="button"
				>
					Previous
				</button>
				<span>
					Page {pageNumber} of {pageCount}
				</span>
				<button
					disabled={!page.hasMore}
					onClick={() => navigate(scope, query, pageNumber + 1)}
					type="button"
				>
					Next
				</button>
			</div>
		</section>
	);
}

function formatVisibleRange(
	start: number,
	count: number,
	total: number
): string {
	if (total === 0) return '0';
	return start + 1 + '-' + (start + count) + ' of ' + total;
}

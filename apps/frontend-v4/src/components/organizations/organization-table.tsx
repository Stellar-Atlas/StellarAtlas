'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
	PublicKnownNetworkPage,
	PublicKnownOrganizationListItem,
	PublicKnownOrganizationScope
} from '../../api/known-network-types';
import {
	formatOrganization24HourAvailability,
	formatOrganization30DayAvailability
} from '../../domain/availability';
import {
	getOrganizationLabel,
	getOrganizationTags
} from '../../domain/network';
import { StatusTags } from '../status-tags';
import {
	defaultOrganizationInventoryFilter,
	isOrganizationInventoryFilter,
	organizationInventoryFilterLabels,
	organizationInventoryFilterOrder
} from '../../domain/known-network-scopes';

interface OrganizationTableProps {
	organizations: readonly PublicKnownOrganizationListItem[];
	page: PublicKnownNetworkPage;
	query: string;
	scope: PublicKnownOrganizationScope;
	selectedOrganizationId?: string;
	totalCount?: number;
}

export function OrganizationTable({
	organizations,
	page,
	query,
	scope,
	selectedOrganizationId,
	totalCount = organizations.length
}: OrganizationTableProps): React.JSX.Element {
	const router = useRouter();
	const [input, setInput] = useState(query);
	const pageNumber = Math.floor(page.offset / page.limit) + 1;
	const pageCount = Math.max(1, Math.ceil(page.total / page.limit));
	const navigate = (
		nextScope: PublicKnownOrganizationScope,
		nextQuery: string,
		nextPage: number
	): void => {
		const params = new URLSearchParams();
		params.set('scope', nextScope);
		if (nextQuery.trim()) params.set('q', nextQuery.trim());
		if (nextPage > 1) params.set('page', nextPage.toString());
		router.push(`/organizations?${params.toString()}`);
	};
	const firstVisible = page.total === 0 ? 0 : page.offset + 1;
	const lastVisible = page.offset + organizations.length;

	return (
		<section className="panel data-panel">
			<div className="panel-heading controls-heading">
				<div>
					<h2>Organizations</h2>
					<span>
						Showing {firstVisible}-{lastVisible} of {page.total} matching from{' '}
						{totalCount} known
					</span>
				</div>
				<div className="table-controls">
					<input
						aria-label="Filter organizations"
						onChange={(event) => setInput(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') navigate(scope, input, 1);
						}}
						placeholder="Filter organizations"
						value={input}
					/>
					<select
						aria-label="Organization inventory scope"
						onChange={(event) => {
							const value = event.currentTarget.value;
							if (isOrganizationInventoryFilter(value))
								navigate(value, input, 1);
						}}
						value={scope}
					>
						{organizationInventoryFilterOrder.map((option) => (
							<option key={option} value={option}>
								{organizationInventoryFilterLabels[option]}
							</option>
						))}
					</select>
				</div>
			</div>
			<div className="responsive-table">
				<table>
					<thead>
						<tr>
							<th>Organization</th>
							<th>Validators</th>
							<th>24H availability</th>
							<th>30D availability</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						{organizations.map((knownOrganization) => {
							const organization = knownOrganization.organization;
							const availability24Hours =
								formatOrganization24HourAvailability(organization);
							const availability30Days =
								formatOrganization30DayAvailability(organization);
							return (
								<tr
									className={
										selectedOrganizationId === organization.id
											? 'active-row'
											: ''
									}
									key={organization.id}
								>
									<td>
										<Link
											href={`/organizations/${encodeURIComponent(organization.id)}`}
										>
											<strong>{getOrganizationLabel(organization)}</strong>
										</Link>
										<small>{organization.homeDomain}</small>
									</td>
									<td>{organization.validators.length}</td>
									<td>
										<span className={`metric-text ${availability24Hours.tone}`}>
											{availability24Hours.value}
										</span>
										{availability24Hours.detail ? (
											<small>{availability24Hours.detail}</small>
										) : null}
									</td>
									<td>
										<span className={`metric-text ${availability30Days.tone}`}>
											{availability30Days.value}
										</span>
										{availability30Days.detail ? (
											<small>{availability30Days.detail}</small>
										) : null}
									</td>
									<td>
										<StatusTags
											tags={[
												...getOrganizationTags(organization),
												...(knownOrganization.scope === 'archived'
													? [{ label: 'archived', tone: 'neutral' as const }]
													: [])
											]}
										/>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<div className="pagination-bar">
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

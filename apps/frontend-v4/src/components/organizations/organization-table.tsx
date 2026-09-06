'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { LocalDateTime } from '../local-date-time';
import {
	organizationInventoryAvailability,
	organizationInventoryTags,
	organizationInventoryHref
} from './organization-inventory-model';
import styles from './organization-inventory.module.css';
import type {
	PublicKnownNetworkPage,
	PublicKnownOrganizationListItem,
	PublicKnownOrganizationScope
} from '../../api/known-network-types';
import { getOrganizationLabel } from '../../domain/network';
import { StatusTags } from '../status-tags';
import {
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
	const [isPending, startTransition] = useTransition();
	useEffect(() => setInput(query), [query]);
	const pageNumber = Math.floor(page.offset / page.limit) + 1;
	const pageCount = Math.max(1, Math.ceil(page.total / page.limit));
	const navigate = (
		nextScope: PublicKnownOrganizationScope,
		nextQuery: string,
		nextPage: number
	): void => {
		startTransition(() =>
			router.push(organizationInventoryHref(nextScope, nextQuery, nextPage))
		);
	};
	const firstVisible = organizations.length === 0 ? 0 : page.offset + 1;
	const lastVisible =
		organizations.length === 0 ? 0 : page.offset + organizations.length;

	return (
		<section
			className={`panel data-panel ${styles.inventory}`}
			aria-busy={isPending}
		>
			<div className="panel-heading controls-heading">
				<div>
					<h2>Organizations</h2>
					<span>
						Showing {firstVisible}-{lastVisible} of {page.total} matching from{' '}
						{totalCount} known
					</span>
				</div>
				<form
					className="table-controls"
					onSubmit={(event) => {
						event.preventDefault();
						navigate(scope, input, 1);
					}}
				>
					<input
						aria-label="Filter organizations"
						onChange={(event) => setInput(event.currentTarget.value)}
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
					<button type="submit" disabled={isPending}>
						Search
					</button>
				</form>
			</div>
			{isPending ? (
				<p className="muted-copy" role="status">
					Updating organizations…
				</p>
			) : null}
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
							const availability24Hours = organizationInventoryAvailability(
								organization,
								knownOrganization.scope,
								'24h'
							);
							const availability30Days = organizationInventoryAvailability(
								organization,
								knownOrganization.scope,
								'30d'
							);
							return (
								<tr
									className={
										selectedOrganizationId === organization.id
											? 'active-row'
											: ''
									}
									key={organization.id}
								>
									<td data-label="Organization">
										<Link
											href={`/organizations/${encodeURIComponent(organization.id)}`}
										>
											<strong>{getOrganizationLabel(organization)}</strong>
										</Link>
										<small>{organization.homeDomain}</small>
										{knownOrganization.scope === 'archived' ? (
											<small>
												Last measured:{' '}
												{knownOrganization.lastMeasurementAt ? (
													<LocalDateTime
														dateTime={knownOrganization.lastMeasurementAt}
													/>
												) : (
													'Not recorded'
												)}
											</small>
										) : null}
									</td>
									<td data-label="Validators">
										{organization.validators.length}
									</td>
									<td data-label="24H availability">
										<span className={`metric-text ${availability24Hours.tone}`}>
											{availability24Hours.value}
										</span>
										{availability24Hours.detail ? (
											<small>{availability24Hours.detail}</small>
										) : null}
									</td>
									<td data-label="30D availability">
										<span className={`metric-text ${availability30Days.tone}`}>
											{availability30Days.value}
										</span>
										{availability30Days.detail ? (
											<small>{availability30Days.detail}</small>
										) : null}
									</td>
									<td data-label="Status">
										<StatusTags
											tags={organizationInventoryTags(
												organization,
												knownOrganization.scope
											)}
										/>
									</td>
								</tr>
							);
						})}
						{organizations.length === 0 ? (
							<tr>
								<td colSpan={5}>
									No organizations match this search and scope.
								</td>
							</tr>
						) : null}
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

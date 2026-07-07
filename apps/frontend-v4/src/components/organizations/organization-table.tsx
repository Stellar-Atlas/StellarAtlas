'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { PublicKnownOrganization } from '../../api/types';
import {
	formatOrganization24HourAvailability,
	formatOrganization30DayAvailability
} from '../../domain/availability';
import {
	getOrganizationLabel,
	getOrganizationTags
} from '../../domain/network';
import { StatusTags } from '../status-tags';

interface OrganizationTableProps {
	organizations: readonly PublicKnownOrganization[];
	selectedOrganizationId?: string;
}

const normalize = (value: string): string => value.toLowerCase();
const pageSize = 12;

export function OrganizationTable({
	organizations,
	selectedOrganizationId
}: OrganizationTableProps): React.JSX.Element {
	const [query, setQuery] = useState('');
	const [page, setPage] = useState(0);
	const visibleOrganizations = useMemo(() => {
		const normalizedQuery = normalize(query.trim());

		return organizations
			.filter((knownOrganization) => {
				const organization = knownOrganization.organization;
				if (normalizedQuery.length === 0) return true;
				const haystack = normalize([
					getOrganizationLabel(organization),
					organization.homeDomain,
					organization.url ?? '',
					organization.twitter ?? '',
					organization.github ?? ''
				].join(' '));
				return haystack.includes(normalizedQuery);
			})
			.toSorted(
				(left, right) =>
					right.organization.validators.length -
						left.organization.validators.length ||
					getOrganizationLabel(left.organization).localeCompare(
						getOrganizationLabel(right.organization)
					)
			);
	}, [organizations, query]);
	const pageCount = Math.max(1, Math.ceil(visibleOrganizations.length / pageSize));
	const currentPage = Math.min(page, pageCount - 1);
	const pagedOrganizations = visibleOrganizations.slice(
		currentPage * pageSize,
		currentPage * pageSize + pageSize
	);
	const firstVisible = visibleOrganizations.length === 0 ? 0 : currentPage * pageSize + 1;
	const lastVisible = Math.min(
		visibleOrganizations.length,
		currentPage * pageSize + pageSize
	);

	useEffect(() => {
		setPage(0);
	}, [query]);

	return (
		<section className="panel data-panel">
			<div className="panel-heading controls-heading">
				<div>
					<h2>Organizations</h2>
					<span>
						Showing {firstVisible}-{lastVisible} of{' '}
						{visibleOrganizations.length} filtered from {organizations.length}
					</span>
				</div>
				<input
					aria-label="Filter organizations"
					onChange={(event) => setQuery(event.currentTarget.value)}
					placeholder="Filter organizations"
					value={query}
				/>
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
						{pagedOrganizations.map((knownOrganization) => {
							const organization = knownOrganization.organization;
							const availability24Hours =
								formatOrganization24HourAvailability(organization);
							const availability30Days =
								formatOrganization30DayAvailability(organization);
							return (
								<tr
									className={selectedOrganizationId === organization.id ? 'active-row' : ''}
									key={organization.id}
								>
									<td>
										<Link href={`/organizations/${encodeURIComponent(organization.id)}`}>
											<strong>{getOrganizationLabel(organization)}</strong>
										</Link>
										<small>{organization.homeDomain}</small>
									</td>
									<td>{organization.validators.length}</td>
									<td>
										<span className={`metric-text ${availability24Hours.tone}`}>
											{availability24Hours.value}
										</span>
										{availability24Hours.detail ? <small>{availability24Hours.detail}</small> : null}
									</td>
									<td>
										<span className={`metric-text ${availability30Days.tone}`}>
											{availability30Days.value}
										</span>
										{availability30Days.detail ? <small>{availability30Days.detail}</small> : null}
									</td>
									<td>
										<StatusTags
											tags={[
												...getOrganizationTags(organization),
												...(!knownOrganization.current
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
					disabled={currentPage === 0}
					onClick={() => setPage((value) => Math.max(0, value - 1))}
					type="button"
				>
					Previous
				</button>
				<span>
					Page {formatPage(currentPage)} of {formatPage(pageCount - 1)}
				</span>
				<button
					disabled={currentPage >= pageCount - 1}
					onClick={() =>
						setPage((value) => Math.min(pageCount - 1, value + 1))
					}
					type="button"
				>
					Next
				</button>
			</div>
		</section>
	);
}

function formatPage(pageIndex: number): number {
	return pageIndex + 1;
}

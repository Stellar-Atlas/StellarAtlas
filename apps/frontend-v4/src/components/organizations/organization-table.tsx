'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { PublicOrganization } from '../../api/types';
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
	organizations: PublicOrganization[];
	selectedOrganizationId?: string;
}

const normalize = (value: string): string => value.toLowerCase();

export function OrganizationTable({
	organizations,
	selectedOrganizationId
}: OrganizationTableProps): React.JSX.Element {
	const [query, setQuery] = useState('');
	const visibleOrganizations = useMemo(() => {
		const normalizedQuery = normalize(query.trim());

		return organizations
			.filter((organization) => {
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
					right.validators.length - left.validators.length ||
					getOrganizationLabel(left).localeCompare(getOrganizationLabel(right))
			);
	}, [organizations, query]);

	return (
		<section className="panel data-panel">
			<div className="panel-heading controls-heading">
				<div>
					<h2>Organizations</h2>
					<span>{visibleOrganizations.length} shown from {organizations.length}</span>
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
						{visibleOrganizations.map((organization) => {
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
									<td><StatusTags tags={getOrganizationTags(organization)} /></td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</section>
	);
}

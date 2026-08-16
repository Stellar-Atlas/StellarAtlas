import Link from 'next/link';
import type {
	PublicSearchArchiveStatus,
	PublicSearchArchiveStatusFilter,
	PublicSearchHit,
	PublicSearchResponse
} from '../../api/search-types';
import type { NodeTag } from '../../domain/network';
import { StatusTags } from '../status-tags';

interface NodeArchiveStatusTableProps {
	readonly archiveStatus: PublicSearchArchiveStatusFilter;
	readonly query: string;
	readonly response: PublicSearchResponse;
}

export function NodeArchiveStatusTable({
	archiveStatus,
	query,
	response
}: NodeArchiveStatusTableProps): React.JSX.Element {
	const pageNumber =
		Math.floor(response.pagination.offset / response.pagination.limit) + 1;
	const pageCount = Math.max(
		1,
		Math.ceil(response.pagination.total / response.pagination.limit)
	);

	return (
		<section className="panel data-panel">
			<div className="panel-heading controls-heading">
				<div>
					<h2>Validator archive evidence</h2>
					<span>
						Showing {formatVisibleRange(response)} from{' '}
						{response.pagination.totalIsExact ? 'an exact' : 'an estimated'}{' '}
						filtered total
					</span>
				</div>
				<form action="/nodes" className="table-controls" method="get">
					<input
						aria-label="Filter validators"
						defaultValue={query}
						name="q"
						placeholder="Filter validators"
					/>
					<select
						aria-label="Archive evidence status"
						defaultValue={archiveStatus}
						name="archiveStatus"
					>
						<option value="">All archive states</option>
						<option value="issue">Archive issues</option>
						<option value="error">Archive errors</option>
						<option value="unreachable">Unreachable archives</option>
						<option value="scanner-issue">Scanner issues</option>
						<option value="ok">No current archive issue</option>
						<option value="unknown">Unknown archive state</option>
					</select>
					<button type="submit">Apply</button>
				</form>
			</div>
			<div className="responsive-table">
				<table>
					<thead>
						<tr>
							<th>Validator</th>
							<th>Organization</th>
							<th>Archive state</th>
							<th>Evidence</th>
						</tr>
					</thead>
					<tbody>
						{response.hits.map((hit) => (
							<ArchiveStatusRow hit={hit} key={hit.id} />
						))}
						{response.hits.length === 0 ? (
							<tr>
								<td colSpan={4}>
									No current validators match this archive state.
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
			<div className="table-pagination">
				{pageNumber > 1 ? (
					<Link href={nodesHref(archiveStatus, query, pageNumber - 1)}>
						Previous
					</Link>
				) : (
					<button disabled type="button">
						Previous
					</button>
				)}
				<span>
					Page {pageNumber} of {pageCount}
				</span>
				{response.pagination.hasMore ? (
					<Link href={nodesHref(archiveStatus, query, pageNumber + 1)}>
						Next
					</Link>
				) : (
					<button disabled type="button">
						Next
					</button>
				)}
			</div>
			<p className="muted-copy">
				Archive issues include confirmed remote archive errors and currently
				unreachable roots. Scanner infrastructure issues stay separate.
			</p>
		</section>
	);
}

function ArchiveStatusRow({ hit }: { readonly hit: PublicSearchHit }) {
	const archiveStatus = hit.archiveStatus ?? 'unknown';
	return (
		<tr>
			<td>
				<Link href={hit.href}>
					<strong>{hit.label}</strong>
				</Link>
				<small>{hit.detail}</small>
			</td>
			<td>
				{hit.organizationName ?? <span className="muted">Unassigned</span>}
			</td>
			<td>
				<StatusTags tags={[archiveStatusTag(archiveStatus)]} />
			</td>
			<td>
				<Link href={`${hit.href}#archive-evidence`}>Inspect evidence</Link>
			</td>
		</tr>
	);
}

function archiveStatusTag(status: PublicSearchArchiveStatus): NodeTag {
	if (status === 'error') {
		return { label: 'archive error', tone: 'danger' };
	}
	if (status === 'unreachable') {
		return { label: 'unreachable', tone: 'danger' };
	}
	if (status === 'scanner-issue') {
		return { label: 'scanner issue', tone: 'warning' };
	}
	if (status === 'ok') return { label: 'no current issue', tone: 'good' };
	return { label: 'unknown', tone: 'neutral' };
}

function nodesHref(
	archiveStatus: PublicSearchArchiveStatusFilter,
	query: string,
	page: number
): string {
	const params = new URLSearchParams({ archiveStatus });
	if (query.trim()) params.set('q', query.trim());
	if (page > 1) params.set('page', page.toString());
	return `/nodes?${params.toString()}`;
}

function formatVisibleRange(response: PublicSearchResponse): string {
	if (response.pagination.total === 0) return '0';
	return `${response.pagination.offset + 1}-${response.pagination.offset + response.hits.length} of ${response.pagination.total}`;
}

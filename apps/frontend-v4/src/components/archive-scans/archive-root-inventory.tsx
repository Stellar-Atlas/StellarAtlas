'use client';

import { useMemo, useState } from 'react';
import type {
	PublicHistoryArchiveStatusSummary,
	PublicNode,
	PublicOrganization
} from '@api/types';
import { formatInteger } from '@format/formatters';
import { LocalDateTime } from '../local-date-time';

import { ArchiveRootRow } from './archive-root-row';
import {
	type ArchiveInventorySort,
	calculateCoveragePercent,
	formatCoveragePercent,
	formatNullableInteger,
	groupAdvertisers,
	normalizeRoot,
	compareSources,
	matchesArchiveSource
} from './archive-inventory-model';
export {
	calculateCoveragePercent,
	formatCoveragePercent,
	getExpectedArchiveCheckpointCount
} from './archive-inventory-model';

interface ArchiveRootInventoryProps {
	readonly nodes: readonly PublicNode[];
	readonly organizations: readonly PublicOrganization[];
	readonly summary: PublicHistoryArchiveStatusSummary;
}

const PAGE_SIZE = 20;

export function ArchiveRootInventory({
	nodes,
	organizations,
	summary
}: ArchiveRootInventoryProps): React.JSX.Element {
	const [sortMode, setSortMode] = useState<ArchiveInventorySort>('failures');
	const [query, setQuery] = useState('');
	const [failuresOnly, setFailuresOnly] = useState(false);
	const [page, setPage] = useState(0);
	const advertisers = useMemo(() => groupAdvertisers(nodes), [nodes]);
	const organizationNames = useMemo(
		() =>
			new Map(
				organizations.map((organization) => [
					organization.id,
					organization.name ?? organization.dba ?? organization.homeDomain
				])
			),
		[organizations]
	);
	const canonical = summary.canonicalProofProgress;
	const sources = useMemo(
		() =>
			summary.sources.toSorted((left, right) =>
				compareSources(left, right, {
					advertisers,
					canonicalArchiveUrlIdentity: canonical.archiveUrlIdentity,
					organizationNames,
					sortMode
				})
			),
		[
			summary.sources,
			advertisers,
			canonical.archiveUrlIdentity,
			organizationNames,
			sortMode
		]
	);
	const filtered = sources.filter(
		(source) =>
			(!failuresOnly ||
				source.archiveEvidenceFailures > 0 ||
				source.mismatchCheckpointProofs > 0) &&
			matchesArchiveSource(
				source,
				query,
				advertisers.get(normalizeRoot(source.archiveUrl)) ?? [],
				organizationNames
			)
	);
	const currentPage = Math.min(
		page,
		Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1)
	);
	const first = currentPage * PAGE_SIZE;
	const visibleSources = filtered.slice(first, first + PAGE_SIZE);
	const canonicalPercent = calculateCoveragePercent(
		canonical.verifiedCheckpoints,
		canonical.totalCheckpoints
	);
	const advertisedSourceCount = sources.filter(
		(source) =>
			(advertisers.get(normalizeRoot(source.archiveUrl))?.length ?? 0) > 0
	).length;
	const validatorCount = nodes.filter(
		(node) => node.historyUrl !== null && node.isValidator
	).length;
	const listenerCount = nodes.filter(
		(node) => node.historyUrl !== null && !node.isValidator
	).length;

	return (
		<>
			<section className="archive-inventory-overview">
				<div className="archive-inventory-metrics">
					<Metric label="captured archive roots" value={summary.sourceCount} />
					<Metric
						label="roots currently advertised"
						value={advertisedSourceCount}
					/>
					<Metric label="validator advertisers" value={validatorCount} />
					<Metric label="listener advertisers" value={listenerCount} />
					<Metric
						label="remote archive failures"
						value={summary.archiveEvidenceFailures}
					/>
					<Metric
						label="scanner infrastructure issues"
						value={summary.scannerIssueFailures}
					/>
				</div>
				<div className="archive-canonical-progress">
					<div>
						<strong>Canonical checkpoint proof chain</strong>
						<span>
							{formatCoveragePercent(canonicalPercent)} complete;{' '}
							{formatInteger(canonical.verifiedCheckpoints)} of{' '}
							{formatInteger(canonical.totalCheckpoints)} unique checkpoint
							positions
						</span>
					</div>
					<progress
						aria-label="Canonical checkpoint proof progress"
						max={Math.max(1, canonical.totalCheckpoints)}
						value={canonical.verifiedCheckpoints}
					/>
					<p>
						Latest contiguous checkpoint ledger:{' '}
						<strong>
							{formatNullableInteger(canonical.latestVerifiedCheckpointLedger)}
						</strong>
						. Next checkpoint:{' '}
						<strong>
							{formatNullableInteger(canonical.nextCheckpointLedger)}
						</strong>
						. Remaining unique positions:{' '}
						<strong>{formatInteger(canonical.remainingCheckpoints)}</strong>.
					</p>
				</div>
			</section>

			<section className="panel archive-root-inventory-panel">
				<div className="panel-heading">
					<div>
						<h2>Archive sources</h2>
						<span className="muted-inline">
							Updated <LocalDateTime dateTime={summary.generatedAt} /> ·
							refreshes automatically
						</span>
					</div>
					<div className="table-controls archive-inventory-controls">
						<input
							type="search"
							aria-label="Find archive, organization or validator"
							placeholder="Find archive, organization or validator"
							value={query}
							onChange={(event) => {
								setQuery(event.currentTarget.value);
								setPage(0);
							}}
						/>
						<select
							aria-label="Sort archive roots"
							onChange={(event) => {
								setSortMode(event.currentTarget.value as ArchiveInventorySort);
								setPage(0);
							}}
							value={sortMode}
						>
							<option value="failures">Remote failures</option>
							<option value="organization">Organization A–Z</option>
							<option value="validator">Validator / listener A–Z</option>
							<option value="coverage-desc">Coverage high to low</option>
							<option value="coverage-asc">Coverage low to high</option>
							<option value="url">Archive root URL A–Z</option>
						</select>
						<label className="archive-failure-filter">
							<input
								type="checkbox"
								checked={failuresOnly}
								onChange={(event) => {
									setFailuresOnly(event.currentTarget.checked);
									setPage(0);
								}}
							/>{' '}
							With archive failures
						</label>
					</div>
				</div>
				<div className="responsive-table archive-root-inventory-table-wrap">
					<table
						className="archive-root-inventory-table"
						role="table"
						aria-label="Archive source coverage and failures"
					>
						<thead role="rowgroup">
							<tr role="row">
								<th role="columnheader" scope="col">
									Archive root
								</th>
								<th role="columnheader" scope="col">
									Current advertisers
								</th>
								<th role="columnheader" scope="col">
									Remote archive evidence
								</th>
								<th role="columnheader" scope="col">
									Durable checkpoint coverage
								</th>
								<th role="columnheader" scope="col">
									Current work
								</th>
								<th role="columnheader" scope="col">
									Inspect / repair
								</th>
							</tr>
						</thead>
						<tbody role="rowgroup">
							{visibleSources.map((source) => (
								<ArchiveRootRow
									advertisers={
										advertisers.get(normalizeRoot(source.archiveUrl)) ?? []
									}
									canonicalArchiveUrlIdentity={canonical.archiveUrlIdentity}
									organizationNames={organizationNames}
									key={source.archiveUrlIdentity}
									source={source}
								/>
							))}
						</tbody>
					</table>
				</div>
				{filtered.length === 0 ? (
					<p className="archive-empty" role="status">
						No archives match these filters.{' '}
						<button
							type="button"
							onClick={() => {
								setQuery('');
								setFailuresOnly(false);
								setPage(0);
							}}
						>
							Clear filters
						</button>
					</p>
				) : null}
				<nav className="pagination-bar" aria-label="Archive pages">
					<span aria-live="polite">
						{filtered.length === 0 ? '0' : formatInteger(first + 1)}–
						{formatInteger(Math.min(first + PAGE_SIZE, filtered.length))} of{' '}
						{formatInteger(filtered.length)} roots
					</span>
					<button
						type="button"
						disabled={currentPage === 0}
						onClick={() => setPage(currentPage - 1)}
					>
						Previous
					</button>
					<button
						type="button"
						disabled={first + PAGE_SIZE >= filtered.length}
						onClick={() => setPage(currentPage + 1)}
					>
						Next
					</button>
				</nav>
			</section>
		</>
	);
}

function Metric({
	label,
	value
}: {
	readonly label: string;
	readonly value: number;
}): React.JSX.Element {
	return (
		<div>
			<strong>{formatInteger(value)}</strong>
			<span>{label}</span>
		</div>
	);
}

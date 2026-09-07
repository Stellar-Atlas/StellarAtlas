'use client';

import { useId, useMemo, useState } from 'react';
import type {
	PublicHistoryArchiveStatusSummary,
	PublicNode,
	PublicOrganization
} from '@api/types';
import { formatInteger } from '@format/formatters';
import { LocalDateTime } from '../local-date-time';

import { ArchiveRootRow } from './archive-root-row';
import {
	archiveGroupPage,
	groupArchiveSources
} from './archive-organization-groups';
import { ArchiveOrganizationGroupHeading } from './archive-organization-group-heading';
import { ArchiveSortHeading } from './archive-sort-heading';
import { ArchiveCoverageHeading } from './archive-coverage-heading';
import {
	type ArchiveInventorySort,
	defaultArchiveInventorySort,
	calculateCoveragePercent,
	formatCoveragePercent,
	formatNullableInteger,
	groupAdvertisers,
	hasArchiveSourceFindings,
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

export function ArchiveRootInventory({
	nodes,
	organizations,
	summary
}: ArchiveRootInventoryProps): React.JSX.Element {
	const groupId = useId();
	const [sortMode, setSortMode] = useState<ArchiveInventorySort>(
		defaultArchiveInventorySort
	);
	const [query, setQuery] = useState('');
	const [failuresOnly, setFailuresOnly] = useState(false);
	const [page, setPage] = useState(0);
	const changeSort = (value: ArchiveInventorySort): void => {
		setSortMode(value);
		setPage(0);
	};
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
					organizationNames,
					sortMode
				})
			),
		[summary.sources, advertisers, organizationNames, sortMode]
	);
	const filtered = sources.filter(
		(source) =>
			(!failuresOnly || hasArchiveSourceFindings(source)) &&
			matchesArchiveSource(
				source,
				query,
				advertisers.get(normalizeRoot(source.archiveUrl)) ?? [],
				organizationNames
			)
	);
	const groups = groupArchiveSources(filtered, {
		advertisers,
		organizationNames,
		sortMode
	});
	const {
		currentPage,
		first,
		visible: visibleGroups,
		hasNext,
		rootCount,
		visibleRootCount
	} = archiveGroupPage(groups, page);
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
								changeSort(event.currentTarget.value as ArchiveInventorySort);
							}}
							value={sortMode}
						>
							<option value="organization">
								Organization → validator → root A–Z
							</option>
							<option value="failures">Remote failures high to low</option>
							<option value="validator">Validator / listener A–Z</option>
							<option value="scan-coverage-desc">
								Scan coverage high to low
							</option>
							<option value="scan-coverage-asc">
								Scan coverage low to high
							</option>
							<option value="coverage-desc">
								Verified coverage high to low
							</option>
							<option value="coverage-asc">
								Verified coverage low to high
							</option>
							<option value="url">Archive root URL A–Z</option>
							<option value="url-desc">Archive root URL Z–A</option>
							<option value="organization-desc">
								Organization → validator → root Z–A
							</option>
							<option value="validator-desc">Validator / listener Z–A</option>
							<option value="failures-asc">Remote failures low to high</option>
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
				<p className="archive-coverage-definition">
					Scanned counts each checkpoint once after a file-check result or a
					confirmed listing gap. Verified means its proof passed. Checked and
					listing-covered counts can overlap; pending jobs are not coverage.
				</p>
				<p className="archive-coverage-definition" id={`${groupId}-sort`}>
					Grouped by organization; shared roots appear once with all
					advertisers. Group coverage weights each matching root by its expected
					checkpoint positions. Sort controls order groups, then roots within
					each group.
				</p>
				<div className="responsive-table archive-root-inventory-table-wrap">
					<table
						className="archive-root-inventory-table"
						role="table"
						aria-label="Archive source coverage and failures"
						aria-describedby={`${groupId}-sort`}
					>
						<thead role="rowgroup">
							<tr role="row">
								<ArchiveSortHeading
									label="Archive source"
									ascending="url"
									descending="url-desc"
									initial="ascending"
									value={sortMode}
									onChange={changeSort}
								/>
								<ArchiveCoverageHeading
									value={sortMode}
									onChange={changeSort}
								/>
								<ArchiveSortHeading
									label="Archive findings"
									ascending="failures-asc"
									descending="failures"
									initial="descending"
									value={sortMode}
									onChange={changeSort}
								/>
								<th role="columnheader" scope="col">
									Details
								</th>
							</tr>
						</thead>
						{visibleGroups.map((group, groupIndex) => (
							<tbody
								role="rowgroup"
								key={group.key}
								aria-labelledby={`${groupId}-${groupIndex}`}
							>
								<ArchiveOrganizationGroupHeading
									group={group}
									id={`${groupId}-${groupIndex}`}
								/>
								{group.sources.map((source) => (
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
						))}
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
						{groups.length === 0 ? '0' : formatInteger(first + 1)}–
						{formatInteger(first + visibleGroups.length)} of{' '}
						{formatInteger(groups.length)} groups ·{' '}
						{formatInteger(visibleRootCount)} of {formatInteger(rootCount)}{' '}
						roots
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
						disabled={!hasNext}
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

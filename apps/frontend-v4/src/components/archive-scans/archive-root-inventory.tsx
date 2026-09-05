'use client';

import Link from 'next/link';
import { useState } from 'react';
import type {
	PublicHistoryArchiveStatusSummary,
	PublicNode,
	PublicOrganization
} from '@api/types';
import { getArchiveScanDetailPath } from '@domain/archive-scan-routes';
import { formatInteger } from '@format/formatters';
import { LocalDateTime } from '../local-date-time';

interface ArchiveRootInventoryProps {
	readonly nodes: readonly PublicNode[];
	readonly organizations: readonly PublicOrganization[];
	readonly summary: PublicHistoryArchiveStatusSummary;
}

type ArchiveSource = PublicHistoryArchiveStatusSummary['sources'][number];
type ArchiveInventorySort =
	| 'failures'
	| 'organization'
	| 'validator'
	| 'coverage-desc'
	| 'coverage-asc'
	| 'url';

export function ArchiveRootInventory({
	nodes,
	organizations,
	summary
}: ArchiveRootInventoryProps): React.JSX.Element {
	const [sortMode, setSortMode] = useState<ArchiveInventorySort>('failures');
	const advertisers = groupAdvertisers(nodes);
	const organizationNames = new Map(
		organizations.map((organization) => [
			organization.id,
			organization.name ?? organization.dba ?? organization.homeDomain
		])
	);
	const canonical = summary.canonicalProofProgress;
	const sources = summary.sources.toSorted((left, right) =>
		compareSources(left, right, {
			advertisers,
			canonicalArchiveUrlIdentity: canonical.archiveUrlIdentity,
			organizationNames,
			sortMode
		})
	);
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
						<h2>Every captured archive root</h2>
						<span className="muted-inline">
							Updated <LocalDateTime dateTime={summary.generatedAt} />; URL path
							case is preserved when matching advertisers
						</span>
					</div>
					<div className="table-controls archive-inventory-controls">
						<select
							aria-label="Sort archive roots"
							onChange={(event) =>
								setSortMode(event.currentTarget.value as ArchiveInventorySort)
							}
							value={sortMode}
						>
							<option value="failures">Remote failures</option>
							<option value="organization">Organization A–Z</option>
							<option value="validator">Validator / listener A–Z</option>
							<option value="coverage-desc">Coverage high to low</option>
							<option value="coverage-asc">Coverage low to high</option>
							<option value="url">Archive root URL A–Z</option>
						</select>
						<strong>{formatInteger(sources.length)} roots</strong>
					</div>
				</div>
				<div className="responsive-table archive-root-inventory-table-wrap">
					<table className="archive-root-inventory-table">
						<thead>
							<tr>
								<th>Archive root</th>
								<th>Current advertisers</th>
								<th>Remote archive evidence</th>
								<th>Durable checkpoint coverage</th>
								<th>Current work</th>
								<th>Inspect / repair</th>
							</tr>
						</thead>
						<tbody>
							{sources.map((source) => (
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

function ArchiveRootRow({
	advertisers,
	canonicalArchiveUrlIdentity,
	organizationNames,
	source
}: {
	readonly advertisers: readonly PublicNode[];
	readonly canonicalArchiveUrlIdentity: string | null;
	readonly organizationNames: ReadonlyMap<string, string>;
	readonly source: ArchiveSource;
}): React.JSX.Element {
	const validators = advertisers.filter((node) => node.isValidator);
	const listeners = advertisers.filter((node) => !node.isValidator);
	const expectedCheckpointProofs = getExpectedArchiveCheckpointCount(source);
	const proofPercent = calculateCoveragePercent(
		source.durableVerifiedCheckpointProofs,
		expectedCheckpointProofs
	);
	const isCanonical =
		canonicalArchiveUrlIdentity !== null &&
		source.archiveUrlIdentity === canonicalArchiveUrlIdentity;

	return (
		<tr>
			<td>
				<div className="archive-root-heading">
					<a className="archive-root-url" href={source.stateUrl}>
						{source.archiveUrl}
					</a>
					{isCanonical ? (
						<span className="archive-canonical-label">
							Canonical proof source
						</span>
					) : null}
				</div>
				<small>
					{source.stateStatus}; root object{' '}
					{source.rootObjectStatus ?? 'not recorded'}
				</small>
				<small>
					Latest advertised ledger {formatNullableInteger(source.currentLedger)}
					; latest discovered checkpoint{' '}
					{formatNullableInteger(source.latestDiscoveredCheckpointLedger)}
				</small>
			</td>
			<td>
				<strong>
					{formatInteger(validators.length)} validators;{' '}
					{formatInteger(listeners.length)} listeners
				</strong>
				{advertisers.length === 0 ? (
					<small>No current node advertises this captured root.</small>
				) : (
					<ul className="archive-advertiser-list">
						{advertisers.map((node) => (
							<li key={node.publicKey}>
								<Link href={'/nodes/' + encodeURIComponent(node.publicKey)}>
									{formatNodeName(node)}
								</Link>
								<small>
									{node.isValidator ? 'validator' : 'listener'} ·{' '}
									{formatOrganizationName(node, organizationNames)} ·{' '}
									{node.publicKey}
								</small>
							</li>
						))}
					</ul>
				)}
			</td>
			<td>
				<strong>
					{formatInteger(source.archiveEvidenceFailures)} unresolved remote
					failures
				</strong>
				<small>
					{formatInteger(source.mismatchCheckpointProofs)} confirmed checkpoint
					mismatches
				</small>
				<small>
					{formatInteger(source.scannerIssueFailures)} separate scanner issues;{' '}
					{formatInteger(source.unclassifiedFailures)} unclassified
				</small>
			</td>
			<td>
				<strong>
					{formatCoveragePercent(proofPercent)} archive checkpoint coverage
				</strong>
				<progress
					aria-label={'Durable checkpoint coverage for ' + source.archiveUrl}
					max={100}
					value={proofPercent}
				/>
				<small>
					{formatInteger(source.durableVerifiedCheckpointProofs)} of{' '}
					{formatInteger(expectedCheckpointProofs)} expected checkpoint
					positions have durable source attestations
				</small>
				<small>
					{formatInteger(source.verifiedCheckpointProofs)} current proof-version
					attestations; {formatInteger(source.totalCheckpointProofs)}{' '}
					materialized proof rows
				</small>
				<small>
					Highest attested checkpoint{' '}
					{formatNullableInteger(source.latestCheckpointLedger)}
				</small>
			</td>
			<td>
				<strong>
					{formatInteger(source.activeObjectChecks)} active checks
				</strong>
				<small>
					{formatInteger(source.pendingCheckpointProofs)} waiting for required
					files
				</small>
				<small>
					{formatInteger(source.notEvaluableCheckpointProofs)} incomplete under
					the current proof
				</small>
				<small>
					{formatInteger(source.objectCompleteCheckpointProofs)} file sets
					complete
				</small>
			</td>
			<td>
				<Link
					className="primary-button"
					href={getArchiveScanDetailPath(source.archiveUrl)}
				>
					Failures and repair
				</Link>
				<small>
					Observed <LocalDateTime dateTime={source.observedAt} />
				</small>
			</td>
		</tr>
	);
}

function groupAdvertisers(
	nodes: readonly PublicNode[]
): Map<string, PublicNode[]> {
	const grouped = new Map<string, PublicNode[]>();
	for (const node of nodes) {
		if (node.historyUrl === null) continue;
		const key = normalizeRoot(node.historyUrl);
		const entries = grouped.get(key) ?? [];
		entries.push(node);
		grouped.set(key, entries);
	}
	for (const entries of grouped.values()) {
		entries.sort((left, right) =>
			formatNodeName(left).localeCompare(formatNodeName(right))
		);
	}
	return grouped;
}

function normalizeRoot(value: string): string {
	try {
		const url = new URL(value);
		const path = url.pathname.replace(/\/+$/, '');
		return url.protocol.toLowerCase() + '//' + url.host.toLowerCase() + path;
	} catch {
		return value.replace(/\/+$/, '');
	}
}

function formatNodeName(node: PublicNode): string {
	return node.name ?? node.alias ?? node.publicKey.slice(0, 12);
}

function formatNullableInteger(value: number | null): string {
	return value === null ? 'none' : formatInteger(value);
}

export function getExpectedArchiveCheckpointCount(
	source: Pick<
		ArchiveSource,
		| 'currentLedger'
		| 'latestCheckpointLedger'
		| 'latestDiscoveredCheckpointLedger'
	>
): number {
	const knownLedgers = [
		source.currentLedger,
		source.latestCheckpointLedger,
		source.latestDiscoveredCheckpointLedger
	].filter((value): value is number => value !== null);
	if (knownLedgers.length === 0) return 0;
	const latestKnownLedger = Math.max(...knownLedgers);
	return latestKnownLedger < 63 ? 0 : Math.floor((latestKnownLedger + 1) / 64);
}

export function calculateCoveragePercent(
	verified: number,
	total: number
): number {
	if (total <= 0) return 0;
	return Math.min(100, Math.max(0, (verified / total) * 100));
}

export function formatCoveragePercent(value: number): string {
	if (value >= 100) return '100%';
	if (value > 0 && value < 0.01) return '<0.01%';
	if (value >= 99.9) return value.toFixed(3) + '%';
	return value.toFixed(2) + '%';
}

interface ArchiveSortContext {
	readonly advertisers: ReadonlyMap<string, readonly PublicNode[]>;
	readonly canonicalArchiveUrlIdentity: string | null;
	readonly organizationNames: ReadonlyMap<string, string>;
	readonly sortMode: ArchiveInventorySort;
}

function compareSources(
	left: ArchiveSource,
	right: ArchiveSource,
	context: ArchiveSortContext
): number {
	const leftIsCanonical =
		context.canonicalArchiveUrlIdentity !== null &&
		left.archiveUrlIdentity === context.canonicalArchiveUrlIdentity;
	const rightIsCanonical =
		context.canonicalArchiveUrlIdentity !== null &&
		right.archiveUrlIdentity === context.canonicalArchiveUrlIdentity;
	if (leftIsCanonical !== rightIsCanonical) return leftIsCanonical ? -1 : 1;

	if (context.sortMode === 'organization') {
		return compareTextKeys(
			organizationSortKey(left, context),
			organizationSortKey(right, context),
			left.archiveUrl,
			right.archiveUrl
		);
	}
	if (context.sortMode === 'validator') {
		return compareTextKeys(
			advertiserSortKey(left, context),
			advertiserSortKey(right, context),
			left.archiveUrl,
			right.archiveUrl
		);
	}
	if (
		context.sortMode === 'coverage-desc' ||
		context.sortMode === 'coverage-asc'
	) {
		const coverageOrder = coverageRatio(left) - coverageRatio(right);
		if (coverageOrder !== 0) {
			return context.sortMode === 'coverage-desc'
				? -coverageOrder
				: coverageOrder;
		}
		return left.archiveUrl.localeCompare(right.archiveUrl);
	}
	if (context.sortMode === 'url') {
		return left.archiveUrl.localeCompare(right.archiveUrl);
	}

	const remoteOrder =
		right.archiveEvidenceFailures - left.archiveEvidenceFailures;
	if (remoteOrder !== 0) return remoteOrder;
	const mismatchOrder =
		right.mismatchCheckpointProofs - left.mismatchCheckpointProofs;
	if (mismatchOrder !== 0) return mismatchOrder;
	const proofOrder =
		right.durableVerifiedCheckpointProofs -
		left.durableVerifiedCheckpointProofs;
	return proofOrder !== 0
		? proofOrder
		: left.archiveUrl.localeCompare(right.archiveUrl);
}

function sourceAdvertisers(
	source: ArchiveSource,
	context: ArchiveSortContext
): readonly PublicNode[] {
	return context.advertisers.get(normalizeRoot(source.archiveUrl)) ?? [];
}

function organizationSortKey(
	source: ArchiveSource,
	context: ArchiveSortContext
): string {
	const names = sourceAdvertisers(source, context)
		.map((node) => formatOrganizationName(node, context.organizationNames))
		.filter((name) => name !== 'unaffiliated')
		.toSorted((left, right) => left.localeCompare(right));
	return names[0] ?? '\uffff';
}

function advertiserSortKey(
	source: ArchiveSource,
	context: ArchiveSortContext
): string {
	const advertisers = sourceAdvertisers(source, context);
	const validators = advertisers.filter((node) => node.isValidator);
	const candidates = validators.length > 0 ? validators : advertisers;
	return (
		candidates
			.map(formatNodeName)
			.toSorted((left, right) => left.localeCompare(right))[0] ?? '\uffff'
	);
}

function formatOrganizationName(
	node: PublicNode,
	organizationNames: ReadonlyMap<string, string>
): string {
	if (node.organizationId === null) return 'unaffiliated';
	return (
		organizationNames.get(node.organizationId) ??
		node.homeDomain ??
		node.organizationId
	);
}

function coverageRatio(source: ArchiveSource): number {
	const expected = getExpectedArchiveCheckpointCount(source);
	return expected === 0 ? 0 : source.durableVerifiedCheckpointProofs / expected;
}

function compareTextKeys(
	leftKey: string,
	rightKey: string,
	leftFallback: string,
	rightFallback: string
): number {
	const order = leftKey.localeCompare(rightKey);
	return order === 0 ? leftFallback.localeCompare(rightFallback) : order;
}

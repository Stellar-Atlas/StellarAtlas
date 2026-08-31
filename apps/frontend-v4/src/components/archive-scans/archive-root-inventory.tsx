import Link from 'next/link';
import type { PublicHistoryArchiveStatusSummary, PublicNode } from '@api/types';
import { getArchiveScanDetailPath } from '@domain/archive-scan-routes';
import { formatDateTime, formatInteger } from '@format/formatters';

interface ArchiveRootInventoryProps {
	readonly nodes: readonly PublicNode[];
	readonly summary: PublicHistoryArchiveStatusSummary;
}

type ArchiveSource = PublicHistoryArchiveStatusSummary['sources'][number];

export function ArchiveRootInventory({
	nodes,
	summary
}: ArchiveRootInventoryProps): React.JSX.Element {
	const advertisers = groupAdvertisers(nodes);
	const sources = summary.sources.toSorted(compareSources);
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
	const canonical = summary.canonicalProofProgress;

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
							Updated {formatDateTime(summary.generatedAt)}; URL path case is
							preserved when matching advertisers
						</span>
					</div>
					<strong>{formatInteger(sources.length)} rows</strong>
				</div>
				<div className="responsive-table archive-root-inventory-table-wrap">
					<table className="archive-root-inventory-table">
						<thead>
							<tr>
								<th>Archive root</th>
								<th>Current advertisers</th>
								<th>Remote archive evidence</th>
								<th>Proof coverage</th>
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
	source
}: {
	readonly advertisers: readonly PublicNode[];
	readonly source: ArchiveSource;
}): React.JSX.Element {
	const validators = advertisers.filter((node) => node.isValidator);
	const listeners = advertisers.filter((node) => !node.isValidator);
	const proofPercent =
		source.totalCheckpointProofs === 0
			? 0
			: (source.verifiedCheckpointProofs / source.totalCheckpointProofs) * 100;

	return (
		<tr>
			<td>
				<a className="archive-root-url" href={source.stateUrl}>
					{source.archiveUrl}
				</a>
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
					{formatInteger(source.verifiedCheckpointProofs)} /{' '}
					{formatInteger(source.totalCheckpointProofs)} verified
				</strong>
				<progress
					aria-label={'Proof coverage for ' + source.archiveUrl}
					max={100}
					value={proofPercent}
				/>
				<small>
					{formatInteger(source.durableVerifiedCheckpointProofs)} durable;
					latest verified checkpoint{' '}
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
				<small>Observed {formatDateTime(source.observedAt)}</small>
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

function compareSources(left: ArchiveSource, right: ArchiveSource): number {
	const remoteOrder =
		right.archiveEvidenceFailures - left.archiveEvidenceFailures;
	if (remoteOrder !== 0) return remoteOrder;
	const mismatchOrder =
		right.mismatchCheckpointProofs - left.mismatchCheckpointProofs;
	if (mismatchOrder !== 0) return mismatchOrder;
	const proofOrder =
		right.verifiedCheckpointProofs - left.verifiedCheckpointProofs;
	return proofOrder !== 0
		? proofOrder
		: left.archiveUrl.localeCompare(right.archiveUrl);
}

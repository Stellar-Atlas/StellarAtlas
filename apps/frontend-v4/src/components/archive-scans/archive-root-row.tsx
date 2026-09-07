import Link from 'next/link';
import { ArchiveFindings } from './archive-findings';
import { ArchiveScanCoverage } from './archive-scan-coverage';
import type { PublicNode } from '@api/types';
import { getArchiveScanDetailPath } from '@domain/archive-scan-routes';
import { formatInteger } from '@format/formatters';
import { LocalDateTime } from '../local-date-time';
import {
	type ArchiveSource,
	formatNullableInteger,
	formatNodeName,
	formatOrganizationName
} from './archive-inventory-model';

export function ArchiveRootRow({
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
	const isCanonical =
		canonicalArchiveUrlIdentity !== null &&
		source.archiveUrlIdentity === canonicalArchiveUrlIdentity;

	return (
		<tr role="row">
			<td role="cell" data-label="Archive source">
				<div className="archive-root-heading">
					<a className="archive-root-url" href={source.archiveUrl}>
						{source.archiveUrl}
					</a>
					{isCanonical ? (
						<span className="archive-canonical-label">Canonical source</span>
					) : null}
				</div>
				{advertisers.length === 0 ? (
					<small>No current advertiser</small>
				) : (
					<ul className="archive-advertiser-list">
						{advertisers.map((node) => (
							<li key={node.publicKey}>
								<Link href={'/nodes/' + encodeURIComponent(node.publicKey)}>
									{formatNodeName(node)}
								</Link>
								<small title={node.publicKey}>
									{formatOrganizationName(node, organizationNames)} ·{' '}
									{node.isValidator ? 'validator' : 'listener'}
								</small>
							</li>
						))}
					</ul>
				)}
			</td>
			<td role="cell" data-label="Coverage">
				<ArchiveScanCoverage source={source} />
				<small>
					Advertised ledger {formatNullableInteger(source.currentLedger)}
				</small>
			</td>
			<td role="cell" data-label="Archive findings">
				<ArchiveFindings source={source} />
			</td>
			<td role="cell" data-label="Details">
				<Link
					className="primary-button"
					href={getArchiveScanDetailPath(source.archiveUrl)}
				>
					Inspect archive
				</Link>
				<details className="archive-check-details">
					<summary>Record details</summary>
					<dl>
						<div>
							<dt>Current-version verified proofs</dt>
							<dd>{formatInteger(source.verifiedCheckpointProofs)}</dd>
						</div>
						<div>
							<dt>Tracked checkpoint records</dt>
							<dd>{formatInteger(source.totalCheckpointProofs)}</dd>
						</div>
						<div>
							<dt>Awaiting required files</dt>
							<dd>{formatInteger(source.pendingCheckpointProofs)}</dd>
						</div>
						<div>
							<dt>Incomplete or older proof version</dt>
							<dd>{formatInteger(source.notEvaluableCheckpointProofs)}</dd>
						</div>
						<div>
							<dt>Required file sets complete</dt>
							<dd>{formatInteger(source.objectCompleteCheckpointProofs)}</dd>
						</div>
						<div>
							<dt>Highest tracked checkpoint ledger (not verified coverage)</dt>
							<dd>
								{formatNullableInteger(source.latestDiscoveredCheckpointLedger)}
							</dd>
						</div>
						<div>
							<dt>Scanner issues (not archive faults)</dt>
							<dd>{formatInteger(source.scannerIssueFailures)}</dd>
						</div>
					</dl>
					<p>
						Retained verified positions include earlier proof versions. Queue
						records are not live worker activity; inspect the archive for live
						checks and repair evidence.
					</p>
					<small>
						Root metadata: {source.stateStatus}; object{' '}
						{source.rootObjectStatus ?? 'not recorded'}.
					</small>
					<small>
						Observed <LocalDateTime dateTime={source.observedAt} />
					</small>
				</details>
			</td>
		</tr>
	);
}

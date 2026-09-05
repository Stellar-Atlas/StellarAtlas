import Link from 'next/link';
import type { PublicNode } from '@api/types';
import { getArchiveScanDetailPath } from '@domain/archive-scan-routes';
import { formatInteger } from '@format/formatters';
import { LocalDateTime } from '../local-date-time';
import {
	type ArchiveSource,
	calculateCoveragePercent,
	formatCoveragePercent,
	formatNullableInteger,
	getExpectedArchiveCheckpointCount,
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
		<tr role="row">
			<td role="cell" data-label="Archive root">
				<div className="archive-root-heading">
					<a className="archive-root-url" href={source.stateUrl}>
						{source.archiveUrl}
					</a>
					{isCanonical ? (
						<span className="archive-canonical-label">Canonical source</span>
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
			<td role="cell" data-label="Advertised by">
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
								<small title={node.publicKey}>
									{node.isValidator ? 'validator' : 'listener'} ·{' '}
									{formatOrganizationName(node, organizationNames)} ·{' '}
									{node.publicKey.slice(0, 8)}…{node.publicKey.slice(-6)}
								</small>
							</li>
						))}
					</ul>
				)}
			</td>
			<td role="cell" data-label="File failures">
				<strong>
					{formatInteger(source.archiveEvidenceFailures)} unresolved archive
					file failures
				</strong>
				<small>
					{formatInteger(source.mismatchCheckpointProofs)} confirmed checkpoint
					mismatches
				</small>
				<small>
					{formatInteger(source.scannerIssueFailures)} scanner issues (not
					archive faults); {formatInteger(source.unclassifiedFailures)}{' '}
					unclassified
				</small>
			</td>
			<td role="cell" data-label="Checkpoint coverage">
				<strong>{formatCoveragePercent(proofPercent)} verified</strong>
				<progress
					aria-label={'Durable checkpoint coverage for ' + source.archiveUrl}
					max={100}
					value={proofPercent}
				/>
				<small>
					{formatInteger(source.durableVerifiedCheckpointProofs)} of{' '}
					{formatInteger(expectedCheckpointProofs)} checkpoint positions
					verified
				</small>
				<details className="archive-check-details">
					<summary>Verification details</summary>
					<small>
						{formatInteger(source.verifiedCheckpointProofs)} current
						proof-version attestations;{' '}
						{formatInteger(source.totalCheckpointProofs)} materialized proof
						rows
					</small>
					<small>
						Highest attested checkpoint{' '}
						{formatNullableInteger(source.latestCheckpointLedger)}
					</small>
				</details>
			</td>
			<td role="cell" data-label="Work queue">
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
			<td role="cell" data-label="Inspect / repair">
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

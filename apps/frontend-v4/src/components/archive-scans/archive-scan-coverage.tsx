import { formatInteger } from '@format/formatters';
import {
	type ArchiveSource,
	calculateCoveragePercent,
	formatCoveragePercent,
	getKnownScannedPositions,
	getExpectedArchiveCheckpointCount
} from './archive-inventory-model';

export function ArchiveScanCoverage({
	source
}: {
	readonly source: ArchiveSource;
}): React.JSX.Element {
	const coverage = source.scanCoverage;
	const expected = getExpectedArchiveCheckpointCount(source);
	const scanned = getKnownScannedPositions(source);
	const verified = source.durableVerifiedCheckpointProofs;
	const verifiedPercent = calculateCoveragePercent(verified, expected);
	const additionalScanEvidence = scanned > verified;
	const reconciling = coverage?.status !== 'complete';
	const scanPercent = calculateCoveragePercent(scanned, expected);
	const listing = coverage?.listingCoveredCheckpointPositions ?? 0;
	const listingPercent =
		coverage && coverage.scannedCheckpointPositions >= verified
			? calculateCoveragePercent(listing, expected)
			: 0;
	const meterPercent = additionalScanEvidence ? scanPercent : verifiedPercent;
	return (
		<>
			<strong className="archive-coverage-value">
				{expected > 0
					? formatCoveragePercent(verifiedPercent)
					: 'Range unknown'}{' '}
				<span className="archive-coverage-kind">verified</span>
			</strong>
			<small>
				{formatInteger(verified)} / {formatInteger(expected)} checkpoint
				positions verified
			</small>
			<div
				className="archive-scan-meter"
				role="progressbar"
				aria-label={
					(additionalScanEvidence
						? 'Checkpoint scan coverage for '
						: 'Verified checkpoint coverage for ') + source.archiveUrl
				}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={meterPercent}
				aria-valuetext={
					additionalScanEvidence
						? (reconciling ? 'At least ' : '') +
							formatCoveragePercent(scanPercent) +
							' scanned'
						: formatCoveragePercent(verifiedPercent) + ' verified'
				}
			>
				<span
					className="archive-scan-meter-checked"
					style={{ width: Math.max(0, meterPercent - listingPercent) + '%' }}
				/>
				{listingPercent > 0 && (
					<span
						className="archive-scan-meter-listing"
						style={{ width: listingPercent + '%' }}
					/>
				)}
			</div>
			{additionalScanEvidence && (
				<small
					className="archive-scan-additional"
					title={
						reconciling
							? 'Known minimum including verified positions. Older check results are still being added without changing the verified total.'
							: undefined
					}
				>
					<strong>
						{reconciling ? '≥' : ''}
						{formatCoveragePercent(scanPercent)} scanned
					</strong>
					{' · '}
					{reconciling ? 'at least ' : ''}
					{formatInteger(scanned)} positions
				</small>
			)}
			{listing > 0 && (
				<small
					className="archive-listing-coverage"
					title="Historical positions covered by complete listing evidence. Later successful checks may overlap; positions are never added twice."
				>
					<span className="archive-evidence-dot archive-evidence-dot-listing" />
					{formatInteger(listing)} positions covered by listing evidence
				</small>
			)}
		</>
	);
}

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
	const reconciling = coverage?.status !== 'complete';
	const percent = calculateCoveragePercent(scanned, expected);
	const listingPercent =
		coverage && coverage.scannedCheckpointPositions >= verified
			? calculateCoveragePercent(
					coverage.listingCoveredCheckpointPositions,
					expected
				)
			: 0;
	const checkedOnlyPercent = Math.max(0, percent - listingPercent);
	return (
		<>
			<strong className="archive-coverage-value">
				{expected > 0
					? (reconciling ? '≥' : '') + formatCoveragePercent(percent)
					: 'Range unknown'}{' '}
				<span className="archive-coverage-kind">scanned</span>
			</strong>
			<div
				className="archive-scan-meter"
				role="progressbar"
				aria-label={'Checkpoint scan coverage for ' + source.archiveUrl}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
				aria-valuetext={
					(reconciling ? 'At least ' : '') +
					formatCoveragePercent(percent) +
					' scanned'
				}
			>
				<span
					className="archive-scan-meter-checked"
					style={{ width: checkedOnlyPercent + '%' }}
				/>
				<span
					className="archive-scan-meter-listing"
					style={{ width: listingPercent + '%' }}
				/>
			</div>
			<small>
				{reconciling ? 'At least ' : ''}
				{formatInteger(scanned)} / {formatInteger(expected)} positions
			</small>
			<small className="archive-verified-subline">
				<strong>
					{formatCoveragePercent(calculateCoveragePercent(verified, expected))}{' '}
					verified
				</strong>{' '}
				· {formatInteger(verified)} passed
			</small>
			{coverage && (
				<small>
					<span className="archive-evidence-dot archive-evidence-dot-checked" />
					{formatInteger(coverage.checkedCheckpointPositions)} checked ·{' '}
					<span className="archive-evidence-dot archive-evidence-dot-listing" />
					{formatInteger(coverage.listingCoveredCheckpointPositions)}{' '}
					listing-covered
				</small>
			)}
			{reconciling && (
				<small title="Older retained check results are being reconciled into this deduplicated counter. The percentage is a known minimum, not a completed scan.">
					Historical count reconciling
				</small>
			)}
		</>
	);
}

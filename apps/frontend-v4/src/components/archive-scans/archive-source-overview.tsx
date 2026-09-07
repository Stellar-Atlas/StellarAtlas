import type { PublicKnownArchiveRootEvidence } from '@api/archive-evidence-types';
import { formatInteger } from '@format/formatters';
import {
	calculateCoveragePercent,
	formatCoveragePercent
} from './archive-inventory-model';

export function sourceCheckpointCoverage(root: PublicKnownArchiveRootEvidence) {
	const head = root.sequentialCoverage.advertisedLatestCheckpointLedger;
	const expected =
		head !== null && Number.isSafeInteger(head) && head >= 63
			? Math.floor((head + 1) / 64)
			: null;
	const verified = root.checkpoints.verifiedCheckpoints;
	return {
		expected,
		verified,
		percent:
			expected === null || verified > expected
				? null
				: calculateCoveragePercent(verified, expected)
	};
}

export function ArchiveSourceOverview({
	root
}: {
	readonly root: PublicKnownArchiveRootEvidence;
}): React.JSX.Element {
	const { expected, verified, percent } = sourceCheckpointCoverage(root);
	const next = root.sequentialCoverage.nextCheckpointLedger;
	return (
		<section
			className="archive-source-overview"
			aria-label="Full archive checkpoint coverage"
		>
			<div className="archive-source-coverage">
				<div className="archive-source-coverage-heading">
					<h3>Full archive coverage</h3>
					<strong>
						{percent === null
							? 'Percentage unavailable'
							: `${formatCoveragePercent(percent)} verified`}
					</strong>
				</div>
				{percent === null ? null : (
					<progress
						aria-label="Verified share of all advertised checkpoints"
						max={100}
						value={percent}
					/>
				)}
				<p>
					<strong>{formatInteger(verified)}</strong> of{' '}
					<strong>
						{expected === null ? 'unknown' : formatInteger(expected)}
					</strong>{' '}
					checkpoint positions verified for this source.
				</p>
				<p className="muted-copy">
					The total covers the full history through its advertised head, not
					just queued files. Missing or unchecked positions are not counted as
					verified.
				</p>
			</div>
			<dl className="archive-source-chain-details">
				<div>
					<dt>Advertised checkpoint ledger</dt>
					<dd>
						{root.sequentialCoverage.advertisedLatestCheckpointLedger === null
							? 'Not reported'
							: formatInteger(
									root.sequentialCoverage.advertisedLatestCheckpointLedger
								)}
					</dd>
				</div>
				<div>
					<dt>Historical catch-up · next checkpoint ledger</dt>
					<dd>
						{next === null ? 'Not reported' : `Ledger ${formatInteger(next)}`}
					</dd>
				</div>
			</dl>
			<p className="archive-source-work-note">
				Historical catch-up follows checkpoint files, 64 ledgers apart. This
				position is not the live network ledger or a count of completed checks.
			</p>
		</section>
	);
}

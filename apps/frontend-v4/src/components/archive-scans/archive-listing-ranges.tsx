import type { ArchiveSource } from './archive-inventory-model';
import { formatInteger } from '@format/formatters';

export function ArchiveListingRanges({
	source
}: {
	readonly source: ArchiveSource;
}): React.JSX.Element | null {
	const count = source.listingGapCount ?? 0;
	if (count === 0) return null;
	const ranges = source.listingGapRanges ?? [];
	return (
		<details className="archive-listing-ranges">
			<summary>
				<span className="archive-evidence-dot archive-evidence-dot-listing" />
				{formatInteger(count)} {count === 1 ? 'range' : 'ranges'} absent from
				filename listings
			</summary>
			<small>
				Complete listings omit the required checkpoint files. These are not
				individual HTTP failures.
			</small>
			<ul>
				{ranges.map((range) => (
					<li
						key={range.firstCheckpointLedger + ':' + range.lastCheckpointLedger}
					>
						<strong>
							Ledger {formatInteger(range.firstCheckpointLedger)}–
							{formatInteger(range.lastCheckpointLedger)}
						</strong>
						<small>
							{formatInteger(range.checkpointCount)} checkpoint positions ·{' '}
							{range.kind.replaceAll('-', ' ')}
						</small>
					</li>
				))}
			</ul>
			{count > ranges.length && (
				<small>
					{formatInteger(count - ranges.length)} more ranges in archive details
				</small>
			)}
		</details>
	);
}

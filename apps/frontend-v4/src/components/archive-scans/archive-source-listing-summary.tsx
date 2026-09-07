import type { PublicKnownArchiveRootEvidence } from '@api/archive-evidence-types';
import { formatInteger } from '@format/formatters';
import { KnownArchiveListingGaps } from './known-archive-listing-gaps';

export function ArchiveSourceListingSummary({
	root
}: {
	readonly root: PublicKnownArchiveRootEvidence;
}): React.JSX.Element {
	const gaps = root.listingGaps ?? [];
	const count = root.listingGapCount ?? gaps.length;
	const listed = new Map<number, Set<string>>();
	for (const gap of gaps)
		for (const listing of gap.listings) {
			if (listing.firstReturnedCheckpoint === null) continue;
			const categories =
				listed.get(listing.firstReturnedCheckpoint) ?? new Set<string>();
			categories.add(
				listing.category === 'history' ? 'checkpoint state' : listing.category
			);
			listed.set(listing.firstReturnedCheckpoint, categories);
		}
	return (
		<section
			className="archive-listing-summary"
			aria-label="Source filename listing evidence"
		>
			<h3>Source filename listings</h3>
			{count === 0 ? (
				<p>
					No complete listing evidence is recorded here. This does not establish
					whether this source offers listings or whether any file is missing.
					Direct request results are shown separately.
				</p>
			) : (
				<>
					<span className="archive-evidence-kind" data-kind="listing-absence">
						Absent from listing
					</span>
					<p>
						<strong>
							{formatInteger(count)} recorded {count === 1 ? 'range' : 'ranges'}
						</strong>{' '}
						absent from complete checkpoint-state, ledger, transactions and
						results listings. These are not individually fetched 404s and are
						not added to that count.
					</p>
					<dl className="archive-listing-facts">
						{gaps.map((gap) => (
							<div
								key={`${gap.firstCheckpointLedger}:${gap.lastCheckpointLedger}`}
							>
								<dt>Missing range</dt>
								<dd>
									Checkpoint ledgers {formatInteger(gap.firstCheckpointLedger)}–
									{formatInteger(gap.lastCheckpointLedger)}
									<br />
									<strong>
										{formatInteger(gap.checkpointCount)} checkpoint positions
									</strong>{' '}
									· all four file categories
								</dd>
							</div>
						))}
					</dl>
					{listed.size > 0 ? (
						<>
							<span className="archive-evidence-kind" data-kind="listed-entry">
								Filename listed · not a successful fetch
							</span>
							<dl className="archive-listing-facts">
								{Array.from(listed, ([checkpoint, categories]) => (
									<div key={checkpoint}>
										<dt>Next listed checkpoint</dt>
										<dd>
											<strong>{formatInteger(checkpoint)}</strong>
											<br />
											{Array.from(categories).join(', ')}
										</dd>
									</div>
								))}
							</dl>
						</>
					) : null}
					<p className="muted-copy">
						A listed filename does not prove its bytes are downloadable or
						correct. These listings do not establish bucket or SCP availability.
					</p>
					{count > gaps.length ? (
						<p>
							Showing {formatInteger(gaps.length)} of {formatInteger(count)}{' '}
							recorded ranges.
						</p>
					) : null}
					<details>
						<summary>
							Listing URLs, observed times and recorded evidence
						</summary>
						<KnownArchiveListingGaps
							roots={[root]}
							archiveUrl={null}
							objectType={null}
						/>
					</details>
				</>
			)}
		</section>
	);
}

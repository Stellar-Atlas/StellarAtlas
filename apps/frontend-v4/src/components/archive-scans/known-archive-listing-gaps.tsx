import type { PublicKnownArchiveEvidence } from '@domain/known-archive-evidence';
import { formatArchiveRoot, getHttpUrl } from '@domain/known-archive-evidence';
import { formatInteger } from '@format/formatters';
import { LocalDateTime } from '../local-date-time';

export function KnownArchiveListingGaps({
	roots,
	archiveUrl,
	objectType
}: {
	readonly roots: PublicKnownArchiveEvidence['roots'];
	readonly archiveUrl: string | null;
	readonly objectType: string | null;
}): React.JSX.Element | null {
	if (
		objectType !== null &&
		!['checkpoint-state', 'ledger', 'transactions', 'results'].includes(
			objectType
		)
	)
		return null;
	const visible = roots.filter(
		(root) =>
			(archiveUrl === null || root.archiveUrlIdentity === archiveUrl) &&
			(root.listingGapCount ?? root.listingGaps?.length ?? 0) > 0
	);
	if (visible.length === 0) return null;
	return (
		<section aria-label="Listing-confirmed missing checkpoint files">
			<div className="known-evidence-section-heading danger">
				<h3>Missing checkpoint files — source listing evidence</h3>
			</div>
			<p>
				Checkpoint state, ledger, transactions and results files are absent from
				these source listings. This is listing evidence, not individual HTTP
				failures; bucket contents are not covered.
			</p>
			{visible.map((root) => (
				<div key={root.archiveUrlIdentity}>
					<h4>{formatArchiveRoot(root.archiveUrl)}</h4>
					{(root.listingGaps ?? []).map((gap) => (
						<details
							key={`${gap.firstCheckpointLedger}:${gap.lastCheckpointLedger}`}
							className="archive-check-details"
						>
							<summary>
								{formatInteger(gap.firstCheckpointLedger)}–
								{formatInteger(gap.lastCheckpointLedger)}:{' '}
								{formatInteger(gap.checkpointCount)} checkpoints with missing
								files
							</summary>
							<p>
								Observed <LocalDateTime dateTime={gap.observedAt} />. Resume
								checkpoint: {formatInteger(gap.resumeCheckpointLedger)}. This
								source range is not verified.
							</p>
							{gap.sourceCheckpointProofId !== null ? (
								<p>
									Continuation boundary proof {gap.sourceCheckpointProofId} at{' '}
									{formatInteger(gap.lastCheckpointLedger)} from{' '}
									{gap.sourceArchiveUrlIdentity === null
										? 'another archive source'
										: formatArchiveRoot(gap.sourceArchiveUrlIdentity)}
									. Alternate-source proof does not resolve these missing files.
								</p>
							) : (
								<p>No verified continuation boundary source recorded.</p>
							)}
							<ul>
								{gap.listings.map((listing) => {
									const url = getHttpUrl(listing.listingUrl);
									return (
										<li key={listing.category}>
											{url === null ? (
												listing.category
											) : (
												<a href={url} target="_blank" rel="noreferrer">
													{listing.category} listing
												</a>
											)}
											:{' '}
											{listing.firstReturnedCheckpoint === null
												? `complete directory listing through checkpoint ${formatInteger(listing.rangeThroughCheckpoint ?? gap.lastCheckpointLedger)}`
												: `first returned checkpoint ${formatInteger(listing.firstReturnedCheckpoint)}`}
											.
											<details>
												<summary>Listing response evidence</summary>
												<p style={{ overflowWrap: 'anywhere' }}>
													{listing.firstReturnedKey === null
														? `Complete prefix: ${listing.completePrefix ?? 'not recorded'}`
														: `First key: ${listing.firstReturnedKey}`}
													<br />
													Response SHA-256: {listing.responseSha256}
												</p>
											</details>
										</li>
									);
								})}
							</ul>
						</details>
					))}
					{(root.listingGapCount ?? 0) > (root.listingGaps?.length ?? 0) ? (
						<p>
							Showing the earliest{' '}
							{formatInteger(root.listingGaps?.length ?? 0)} of{' '}
							{formatInteger(root.listingGapCount ?? 0)} unresolved listing
							ranges.
						</p>
					) : null}
				</div>
			))}
		</section>
	);
}

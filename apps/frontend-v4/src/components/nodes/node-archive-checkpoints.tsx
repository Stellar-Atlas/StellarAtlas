import Link from 'next/link';
import type {
	PublicKnownArchiveRemoteFailure,
	PublicKnownArchiveRootEvidence
} from '../../api/archive-evidence-types';
import { getArchiveScanDetailPath } from '../../domain/archive-scan-routes';
import {
	formatArchiveRoot,
	unresolvedRemoteFailureCount
} from '../../domain/known-archive-evidence';
import { formatInteger } from '../../format/formatters';
import { formatCoveragePercent } from '../archive-scans/archive-inventory-model';
import { LocalDateTime } from '../local-date-time';
import {
	checkpointFiles,
	nodeArchiveCheckpointModel
} from './node-archive-checkpoint-model';
import styles from './node-archive-checkpoints.module.css';

export function NodeArchiveCheckpoints({
	roots,
	failures
}: {
	readonly roots: readonly PublicKnownArchiveRootEvidence[];
	readonly failures: readonly PublicKnownArchiveRemoteFailure[];
}): React.JSX.Element {
	return (
		<section
			className={styles.summary}
			aria-label="Archive checkpoint coverage"
		>
			{roots.length === 0 ? (
				<p>
					Checkpoint coverage is unavailable: no archive roots were returned.
				</p>
			) : null}
			{roots.map((root) => {
				const model = nodeArchiveCheckpointModel(root, failures);
				const coverage = root.sequentialCoverage;
				const href = getArchiveScanDetailPath(root.archiveUrlIdentity);
				return (
					<article key={root.archiveUrlIdentity} className={styles.root}>
						<header className={styles.heading}>
							<h3>
								<Link href={href} prefetch={false}>
									{formatArchiveRoot(root.archiveUrlIdentity)}
								</Link>
							</h3>
							<strong>
								{model.percent === null
									? 'Percentage unavailable'
									: `${formatCoveragePercent(model.percent)} verified`}
							</strong>
						</header>
						<p className={styles.coverage}>
							<strong>
								{formatInteger(model.verified)} /{' '}
								{model.expected === null
									? 'unknown'
									: formatInteger(model.expected)}
							</strong>{' '}
							checkpoint positions verified
						</p>
						<p className="muted-copy">
							Retained verified evidence, not a count of files. Current findings
							remain separate.
						</p>
						{model.percent !== null ? (
							<progress
								aria-label={`Verified checkpoint coverage for ${formatArchiveRoot(root.archiveUrlIdentity)}`}
								max={100}
								value={model.percent}
							/>
						) : null}
						<dl className={styles.positions}>
							<div>
								<dt>Advertised checkpoint ledger</dt>
								<dd>{checkpoint(coverage.advertisedLatestCheckpointLedger)}</dd>
							</div>
							<div>
								<dt>Next historical checkpoint</dt>
								<dd>{checkpoint(coverage.nextCheckpointLedger)}</dd>
							</div>
						</dl>
						<p className="muted-copy">
							The next checkpoint is a scan position, not proof of an unbroken
							verified range. Scanning can continue past recorded archive
							failures.
						</p>
						<details className={styles.details}>
							<summary>
								File findings ·{' '}
								{formatInteger(unresolvedRemoteFailureCount(root.objects))}{' '}
								unresolved checks
								{(root.listingGapCount ?? root.listingGaps?.length ?? 0) > 0
									? ` · ${formatInteger(root.listingGapCount ?? root.listingGaps?.length ?? 0)} missing-file ranges`
									: ''}
							</summary>
							<p className="muted-copy">
								The counts below describe this findings page, not all checkpoint
								positions or every error at this source.
							</p>
							{model.findings.length > 0 ? (
								<ul>
									{model.findings.map((finding) => (
										<li key={finding.type}>
											<strong>
												{finding.label}: {formatInteger(finding.count)}
											</strong>{' '}
											on this page — {finding.reasons.join('; ')}.
										</li>
									))}
								</ul>
							) : (
								<p>
									No classified archive-file faults appear on this page; this is
									not an all-clear for the root.
								</p>
							)}
							{model.inconclusiveOnPage > 0 ? (
								<p>
									{formatInteger(model.inconclusiveOnPage)} inconclusive
									transport checks on this page; not proven archive faults.
								</p>
							) : null}
							{root.objects.workerIssueObjects > 0 ? (
								<p>
									{formatInteger(root.objects.workerIssueObjects)}{' '}
									infrastructure checks are recorded separately; not archive
									faults.
								</p>
							) : null}
							<ListingGapSummary root={root} />
						</details>
						<Link href={href} prefetch={false}>
							Root findings &amp; repair / download details
						</Link>
					</article>
				);
			})}
			<details className={styles.details}>
				<summary>Files behind each checkpoint</summary>
				<p>
					Checkpoint files group 64 ledgers. Required proof inputs are
					checkpoint state, ledger headers, transactions, results and referenced
					buckets. SCP history is separate.
				</p>
				<dl className={styles.files}>
					{checkpointFiles.map((file) => (
						<div key={file.type}>
							<dt>{file.label}</dt>
							<dd>
								<code>{file.path}</code>
								<span>{file.purpose}</span>
							</dd>
						</div>
					))}
				</dl>
				<p className="muted-copy">
					XXXXXXXX is the checkpoint ledger in 8-digit hexadecimal; aa/bb/cc are
					its first six digits. Bucket paths use the content hash instead.
				</p>
			</details>
		</section>
	);
}

function checkpoint(value: number | null): string {
	return value === null ? 'Not reported' : `Ledger ${formatInteger(value)}`;
}

function ListingGapSummary({
	root
}: {
	readonly root: PublicKnownArchiveRootEvidence;
}): React.JSX.Element | null {
	const count = root.listingGapCount ?? root.listingGaps?.length ?? 0;
	if (count === 0) return null;
	const first = root.listingGaps?.[0];
	return (
		<div className={styles.gap}>
			<strong>
				{formatInteger(count)} listing-confirmed missing-file{' '}
				{count === 1 ? 'range' : 'ranges'}
			</strong>
			{first ? (
				<p>
					First returned range: checkpoint ledgers{' '}
					{formatInteger(first.firstCheckpointLedger)}–
					{formatInteger(first.lastCheckpointLedger)} (
					{formatInteger(first.checkpointCount)} positions). Observed{' '}
					<LocalDateTime dateTime={first.observedAt} />.
				</p>
			) : null}
			<p>
				Complete listings establish absent checkpoint state, ledger, transaction
				and result files—not absent buckets or SCP files. These positions are
				not marked verified by the listing.
			</p>
		</div>
	);
}

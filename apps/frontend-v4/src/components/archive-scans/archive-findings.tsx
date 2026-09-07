import type { ArchiveSource } from './archive-inventory-model';
import { formatInteger } from '@format/formatters';
import { LocalDateTime } from '../local-date-time';
import { ArchiveListingRanges } from './archive-listing-ranges';
type Reason = NonNullable<ArchiveSource['failureSummary']>['groups'][number];
const categories: Record<string, string> = {
	'history-archive-state': 'Root state',
	'checkpoint-state': 'Checkpoint state',
	ledger: 'Ledger',
	transactions: 'Transactions',
	results: 'Results',
	scp: 'SCP',
	bucket: 'Bucket'
};
function ReasonRow({ reason }: { readonly reason: Reason }): React.JSX.Element {
	return (
		<li>
			<strong>
				{formatInteger(reason.count)}{' '}
				{categories[reason.objectType] ?? reason.objectType} ·{' '}
				{reason.httpStatus
					? 'HTTP ' +
						reason.httpStatus +
						(reason.httpStatus >= 200 && reason.httpStatus < 300
							? ' · check failed'
							: '')
					: (reason.errorType ?? 'Unclassified failure').replaceAll('_', ' ')}
			</strong>
			<small>
				{reason.errorMessage ?? 'No lower-level failure reason was recorded.'}
			</small>
		</li>
	);
}
export function ArchiveFindings({
	source
}: {
	readonly source: ArchiveSource;
}): React.JSX.Element {
	const summary = source.failureSummary;
	const count =
		summary?.status !== 'unavailable' &&
		(summary?.knownAffectedCheckpointCount ?? 0) > 0
			? summary.knownAffectedCheckpointCount
			: undefined;
	const hasReasons = summary && summary.status !== 'unavailable';
	const remoteCount = source.archiveEvidenceFailures;
	const unknown = summary?.unknownCheckpointFailureCount ?? 0;
	return (
		<>
			{remoteCount === 0 ? (
				<strong>No unresolved file checks</strong>
			) : (
				<>
					<strong>
						{count == null
							? 'Unresolved source checks'
							: formatInteger(count) +
								' checkpoint' +
								(count === 1 ? '' : 's') +
								' with unresolved checks'}
					</strong>
					{hasReasons ? (
						<>
							{count == null && (
								<small>
									{formatInteger(remoteCount)} unresolved file checks;
									affected-checkpoint total refreshing.
								</small>
							)}
							<ul className="archive-failure-reasons">
								{summary.groups.slice(0, 3).map((reason, index) => (
									<ReasonRow key={index} reason={reason} />
								))}
							</ul>
							{summary.groups.length > 3 && (
								<details className="archive-extra-findings">
									<summary>
										{summary.groups.length - 3} more failure types
									</summary>
									<ul className="archive-failure-reasons">
										{summary.groups.slice(3).map((reason, index) => (
											<ReasonRow key={index} reason={reason} />
										))}
									</ul>
								</details>
							)}
							{(summary.remainingFailureCount ?? 0) > 0 && (
								<small>
									{formatInteger(summary.remainingFailureCount!)} further checks
									across {formatInteger(summary.remainingGroupCount ?? 0)} types
									in archive details
								</small>
							)}
							{unknown > 0 && (
								<small>
									{formatInteger(unknown)} failed checks without a definite
									checkpoint attribution (such as shared buckets or root state).
								</small>
							)}
							{summary.computedAt && (
								<small className="archive-finding-asof">
									Reasons as of <LocalDateTime dateTime={summary.computedAt} />
									{summary.status === 'stale' ? ' · refreshing' : ''}
								</small>
							)}
						</>
					) : (
						<small>
							{formatInteger(remoteCount)} unresolved checks; reason summary is
							being prepared. Inspect archive for individual results.
						</small>
					)}
				</>
			)}
			<ArchiveListingRanges source={source} />
			{source.mismatchCheckpointProofs > 0 && (
				<small>
					{formatInteger(source.mismatchCheckpointProofs)} checkpoint integrity
					mismatches
				</small>
			)}
			{source.unclassifiedFailures > 0 && (
				<small>
					{formatInteger(source.unclassifiedFailures)} unclassified findings
				</small>
			)}
		</>
	);
}

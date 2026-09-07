import type { ArchiveSource } from './archive-inventory-model';
import {
	getArchiveFaultCount,
	getArchiveFaultGroups
} from './archive-finding-model';
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
function ReasonRow({
	reason,
	expanded = false
}: {
	readonly reason: Reason;
	readonly expanded?: boolean;
}): React.JSX.Element {
	const status = reason.httpStatus;
	const label = status
		? 'HTTP ' +
			status +
			(status >= 200 && status < 300 ? ' · content check failed' : '')
		: (reason.errorType ?? 'Unclassified failure').replaceAll('_', ' ');
	return (
		<li>
			<span className="archive-reason-count">
				{formatInteger(reason.count)}
			</span>
			<span>
				<strong>
					{categories[reason.objectType] ?? reason.objectType} · {label}
				</strong>
				{expanded && (
					<small>
						{reason.errorMessage ??
							'No lower-level failure reason was recorded.'}
					</small>
				)}
			</span>
		</li>
	);
}
export function ArchiveFindings({
	source
}: {
	readonly source: ArchiveSource;
}): React.JSX.Element {
	const summary = source.failureSummary;
	const faults = getArchiveFaultCount(source);
	const reasons = getArchiveFaultGroups(source);
	const hasClassifiedCount = summary?.archiveFaultCount != null;
	const count =
		hasClassifiedCount && (summary?.knownAffectedCheckpointCount ?? 0) > 0
			? summary?.knownAffectedCheckpointCount
			: undefined;
	return (
		<div className="archive-findings-compact">
			{faults === 0 ? (
				<strong className="archive-findings-clear">
					No unresolved archive faults
				</strong>
			) : (
				<>
					<strong className="archive-findings-title">
						{count == null
							? 'Unresolved archive checks'
							: formatInteger(count) +
								' checkpoint' +
								(count === 1 ? '' : 's') +
								' with archive findings'}
					</strong>
					{reasons.length > 0 ? (
						<>
							<ul className="archive-failure-reasons archive-reason-preview">
								{reasons.slice(0, 3).map((reason, index) => (
									<ReasonRow key={index} reason={reason} />
								))}
							</ul>
							<details className="archive-extra-findings">
								<summary>
									Exact responses
									{reasons.length > 3
										? ' · ' + (reasons.length - 3) + ' more types'
										: ''}
								</summary>
								<ul className="archive-failure-reasons">
									{reasons.map((reason, index) => (
										<ReasonRow key={index} reason={reason} expanded />
									))}
								</ul>
								{(summary?.remainingFailureCount ?? 0) > 0 && (
									<small>
										Additional recorded checks are available in archive details.
									</small>
								)}
								{hasClassifiedCount &&
									(summary?.unknownCheckpointFailureCount ?? 0) > 0 && (
										<small>
											{formatInteger(summary!.unknownCheckpointFailureCount!)}{' '}
											checks without a definite checkpoint (shared buckets or
											root state).
										</small>
									)}
								{summary?.computedAt && (
									<small className="archive-finding-asof">
										Responses as of{' '}
										<LocalDateTime dateTime={summary.computedAt} />
										{summary.status === 'stale' ? ' · refreshing' : ''}
									</small>
								)}
							</details>
						</>
					) : (
						<small>
							Reason summary is refreshing. Inspect archive for individual
							results.
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
					{formatInteger(source.unclassifiedFailures)} unclassified checks
				</small>
			)}
		</div>
	);
}

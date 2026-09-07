import type {
	PublicHistoryArchiveObjectType,
	PublicKnownArchiveRootEvidence
} from '@api/archive-evidence-types';
import {
	formatArchiveObjectType,
	unresolvedRemoteFailureCount
} from '@domain/known-archive-evidence';
import { formatInteger } from '@format/formatters';
import { LocalDateTime } from '../local-date-time';
import { sanitizeEvidenceMessage } from './known-archive-evidence-table-parts';

type FailureGroup = NonNullable<
	PublicKnownArchiveRootEvidence['failureSummary']
>['groups'][number];

export function describeArchiveFailure(
	group: Pick<FailureGroup, 'httpStatus' | 'errorType' | 'failureChannel'>
): string {
	if (group.httpStatus === 404)
		return 'HTTP 404 — file not found at the requested URL';
	if (group.httpStatus === 403)
		return 'HTTP 403 — access denied; response alone does not establish whether the file exists';
	if (group.httpStatus === 429) return 'HTTP 429 — source rate limit';
	if (
		group.httpStatus !== null &&
		(group.httpStatus < 200 || group.httpStatus >= 300)
	)
		return `HTTP ${group.httpStatus} — remote request failed`;
	const reason = group.errorType
		?.replaceAll('_', ' ')
		.replaceAll('-', ' ')
		.trim();
	return (
		reason ||
		(group.failureChannel === 'archive_evidence'
			? 'Archive content check failed'
			: 'Archive request failed')
	);
}

export function ArchiveSourceErrorSummary({
	root,
	onInspect
}: {
	readonly root: PublicKnownArchiveRootEvidence;
	readonly onInspect: (type: PublicHistoryArchiveObjectType | null) => void;
}): React.JSX.Element {
	const summary = root.failureSummary;
	const total =
		summary?.remoteFailureCount ?? unresolvedRemoteFailureCount(root.objects);
	const groups = summary?.groups ?? [];
	return (
		<section
			className="archive-source-error-summary"
			aria-label="Archive error summary"
		>
			<div className="archive-source-coverage-heading">
				<h3>Direct file checks</h3>
				<button type="button" onClick={() => onInspect(null)}>
					{formatInteger(total)} unresolved file checks
				</button>
			</div>
			<span className="archive-evidence-kind" data-kind="request">
				Request or content-check failure
			</span>
			<p className="muted-copy">
				Grouped by file type and recorded failure. Scanner infrastructure issues
				are excluded; failures remain unresolved until a successful recheck
				replaces them.
			</p>
			{summary?.computedAt ? (
				<small>
					Summary updated <LocalDateTime dateTime={summary.computedAt} />
					{summary.status === 'stale'
						? ' · Refresh unavailable; showing the last summary.'
						: ' · Cached for up to 5 minutes.'}
				</small>
			) : null}
			{summary === undefined || summary.status === 'unavailable' ? (
				<p>
					Grouped reasons are temporarily unavailable. Individual failures and
					the unresolved total remain available below.
				</p>
			) : groups.length === 0 && total === 0 ? (
				<p>No unresolved remote file failures recorded.</p>
			) : (
				<ul className="archive-source-error-groups">
					{groups.map((group, index) => (
						<li
							className="archive-source-error-group"
							key={`${group.objectType}:${index}`}
						>
							<button type="button" onClick={() => onInspect(group.objectType)}>
								<span>{formatArchiveObjectType(group.objectType)}</span>
								<strong className="archive-source-error-count">
									{formatInteger(group.count)}
								</strong>
							</button>
							<div className="archive-source-error-reason">
								<strong>{describeArchiveFailure(group)}</strong>
								{group.errorMessage ? (
									<details>
										<summary>Recorded message</summary>
										<p>{sanitizeEvidenceMessage(group.errorMessage)}</p>
									</details>
								) : (
									<small>No additional message was recorded.</small>
								)}
							</div>
						</li>
					))}
				</ul>
			)}
			{(summary?.remainingGroupCount ?? 0) > 0 ? (
				<p>
					{formatInteger(summary?.remainingFailureCount ?? 0)} more failures in{' '}
					{formatInteger(summary?.remainingGroupCount ?? 0)} additional reason
					groups. Use the file details to inspect them.
				</p>
			) : null}
		</section>
	);
}

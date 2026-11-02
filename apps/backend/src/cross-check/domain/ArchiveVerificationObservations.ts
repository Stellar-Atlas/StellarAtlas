import { Url } from '@core/domain/Url.js';
import {
	isHistoryArchiveInconclusiveTransportFailure,
	type HistoryArchiveEvidenceV2
} from 'shared';
import type { RadarHistoryArchiveScanDTO } from './RadarHistoryArchiveScan.js';

export type ArchiveObservationPolicy =
	| { readonly state: 'unknown' }
	| {
			readonly state: 'configured';
			readonly now: string;
			readonly maxAgeMs: number;
			readonly maxFutureSkewMs: number;
	  };
type RadarInput =
	| { readonly status: 'loaded'; readonly scan: RadarHistoryArchiveScanDTO }
	| { readonly status: 'not_loaded' | 'not_found' | 'unavailable' };
type AtlasEvidence = Pick<
	HistoryArchiveEvidenceV2,
	'archiveUrl' | 'generatedAt' | 'remoteFailures' | 'workerIssues'
>;
type AtlasInput =
	| { readonly status: 'loaded'; readonly evidence: AtlasEvidence }
	| { readonly status: 'not_loaded' | 'unavailable' };
export interface ArchiveObservedReport {
	readonly objectUrl: string | null;
	reportedBy: 'radar' | 'atlas' | 'both';
	radar: {
		readonly attribution: 'unclassified';
		readonly observedAt: string;
	} | null;
	atlas: {
		readonly observedAt: string;
		readonly checkpointLedger: number | null;
		readonly failureChannel:
			'archive_evidence' | 'archive_availability' | 'unknown';
		readonly inconclusiveTransport: boolean;
	} | null;
}

function rootIdentity(value: string): string | null {
	const result = Url.create(value);
	return result.isOk() ? result.value.value : null;
}
function observationTime(value: string, policy: ArchiveObservationPolicy) {
	const observed = Date.parse(value);
	if (!Number.isFinite(observed))
		return { status: 'invalid_timestamp' as const, elapsedMs: null };
	if (policy.state === 'unknown')
		return { status: 'policy_unknown' as const, elapsedMs: null };
	const now = Date.parse(policy.now);
	if (
		!Number.isFinite(now) ||
		!Number.isFinite(policy.maxAgeMs) ||
		policy.maxAgeMs < 0 ||
		!Number.isFinite(policy.maxFutureSkewMs) ||
		policy.maxFutureSkewMs < 0
	)
		return { status: 'invalid_policy' as const, elapsedMs: null };
	const elapsedMs = now - observed;
	return {
		status:
			elapsedMs < -policy.maxFutureSkewMs
				? ('future' as const)
				: elapsedMs > policy.maxAgeMs
					? ('stale' as const)
					: ('within_policy' as const),
		elapsedMs
	};
}
function objectIdentity(value: string | null, root: string): string | null {
	if (value === null) return null;
	try {
		const url = new URL(value),
			archive = new URL(root);
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.hash ||
			url.search ||
			url.origin !== archive.origin ||
			(url.pathname !== archive.pathname &&
				!url.pathname.startsWith(archive.pathname.replace(/\/$/, '') + '/'))
		)
			return null;
		return url.href;
	} catch {
		return null;
	}
}

/** Observed reports only: neither a missing row nor a partial page proves absence. */
export function projectArchiveVerificationObservations(input: {
	readonly requestedRoot: string;
	readonly radar: RadarInput;
	readonly atlas: AtlasInput;
	readonly policy: ArchiveObservationPolicy;
	readonly limit: number;
}) {
	if (
		!Number.isSafeInteger(input.limit) ||
		input.limit < 1 ||
		input.limit > 100
	)
		throw new RangeError('Observation limit must be between 1 and 100');
	const root = rootIdentity(input.requestedRoot);
	const radar = input.radar.status === 'loaded' ? input.radar.scan : null;
	const atlas = input.atlas.status === 'loaded' ? input.atlas.evidence : null;
	const identityState =
		root === null
			? 'invalid_root'
			: (radar && rootIdentity(radar.url) !== root) ||
				  (atlas && rootIdentity(atlas.archiveUrl) !== root) ||
				  (atlas &&
						(atlas.remoteFailures.filters.archiveUrlIdentity !== root ||
							atlas.workerIssues.filters.archiveUrlIdentity !== root))
				? 'identity_mismatch'
				: 'matched';
	const reports: ArchiveObservedReport[] = [];
	let invalidObjectIdentity = false;
	if (identityState === 'matched' && root !== null) {
		if (radar?.hasError) {
			const objectUrl = objectIdentity(radar.errorUrl, root);
			invalidObjectIdentity ||= radar.errorUrl !== null && objectUrl === null;
			reports.push({
				objectUrl,
				reportedBy: 'radar',
				radar: { attribution: 'unclassified', observedAt: radar.endDate },
				atlas: null
			});
		}
		for (const item of atlas?.remoteFailures.failures.slice(0, input.limit) ??
			[]) {
			if (
				rootIdentity(item.object.archiveUrlIdentity) !== root ||
				rootIdentity(item.object.archiveUrl) !== root
			) {
				invalidObjectIdentity = true;
				continue;
			}
			const objectUrl = objectIdentity(item.object.objectUrl, root);
			invalidObjectIdentity ||= objectUrl === null;
			const finding = item.retainedFinding;
			const evidence = {
				observedAt: finding?.observedAt ?? item.object.updatedAt,
				checkpointLedger: item.object.checkpointLedger,
				failureChannel: finding?.failureChannel ?? ('unknown' as const),
				inconclusiveTransport: isHistoryArchiveInconclusiveTransportFailure({
					errorType: finding?.errorType ?? item.object.error?.type,
					errorMessage: finding?.errorMessage ?? item.object.error?.message,
					httpStatus: finding?.httpStatus ?? item.object.error?.httpStatus
				})
			};
			const same =
				objectUrl === null
					? undefined
					: reports.find(
							(report) =>
								report.objectUrl === objectUrl && report.atlas === null
						);
			if (same) {
				same.reportedBy = 'both';
				same.atlas = evidence;
			} else
				reports.push({
					objectUrl,
					reportedBy: 'atlas',
					radar: null,
					atlas: evidence
				});
		}
	}
	const page = atlas?.remoteFailures;
	const pageState =
		page === undefined
			? 'not_loaded'
			: page.hasMore ||
				  page.nextCursor !== null ||
				  page.total > page.failures.length ||
				  page.failures.length > input.limit
				? 'capped'
				: page.total !== page.failures.length
					? 'inconsistent'
					: 'complete_loaded_page';
	return {
		archiveUrl: root,
		identityState,
		radar: {
			status: input.radar.status,
			scanStartedAt: radar?.startDate ?? null,
			observedAt: radar?.endDate ?? null,
			fetchedAt: radar?.fetchedAt ?? null,
			contentHashSha256: radar?.contentHashSha256 ?? null,
			timing: radar ? observationTime(radar.endDate, input.policy) : null,
			windowState:
				radar &&
				(!Number.isFinite(Date.parse(radar.startDate)) ||
					!Number.isFinite(Date.parse(radar.endDate)) ||
					Date.parse(radar.startDate) > Date.parse(radar.endDate))
					? 'invalid_window'
					: 'not_compared',
			findingCoverage: 'unknown' as const,
			checkpointScope: 'unknown' as const
		},
		atlas: {
			status: input.atlas.status,
			snapshotAt: page?.snapshotAt ?? null,
			snapshotTiming: page
				? observationTime(page.snapshotAt, input.policy)
				: null,
			pageState,
			workerIssueCount: atlas?.workerIssues.total ?? null,
			workerIssuesExcludedFromReports: true as const
		},
		reports: reports
			.slice(0, input.limit)
			.map((report) => ({
				...report,
				atlasTiming: report.atlas
					? observationTime(report.atlas.observedAt, input.policy)
					: null,
				conclusion: 'observed_reports_only' as const
			})),
		truncated:
			reports.length > input.limit ||
			(page?.failures.length ?? 0) > input.limit,
		invalidObjectIdentity,
		absenceEstablished: false as const,
		scopeComparison: 'unknown_or_unequal' as const,
		note: 'Reported by one source does not establish that the other missed an error.'
	};
}

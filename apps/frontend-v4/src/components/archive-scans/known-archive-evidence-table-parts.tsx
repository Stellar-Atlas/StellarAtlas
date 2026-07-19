import Link from 'next/link';
import type {
	PublicHistoryArchiveObject,
	PublicKnownArchiveRemoteFailure,
	PublicKnownArchiveRootEvidence
} from '@api/archive-evidence-types';
import { getArchiveScanDetailPath } from '@domain/archive-scan-routes';
import {
	formatArchiveObjectType,
	formatArchiveRoot,
	getArchiveObjectLabel,
	getHttpUrl,
	getVerifiedCopyObjectUrl
} from '@domain/known-archive-evidence';
import { formatDateTime, formatInteger } from '@format/formatters';
import {
	archiveRefreshFailureLabel,
	classifyArchiveRefreshFailure
} from './archive-refresh-state';

export function ObjectIdentity({
	object
}: {
	readonly object: PublicHistoryArchiveObject;
}): React.JSX.Element {
	return (
		<>
			<strong>{formatArchiveObjectType(object.objectType)}</strong>
			<small className="archive-object-hash">
				{getArchiveObjectLabel(object)}
			</small>
		</>
	);
}

export function ObjectSource({
	object
}: {
	readonly object: PublicHistoryArchiveObject;
}): React.JSX.Element {
	return (
		<ArchiveSourceLink archiveUrl={object.archiveUrl}>
			{formatArchiveRoot(object.archiveUrl)}
		</ArchiveSourceLink>
	);
}

export function VerifiedAlternateCopies({
	failure
}: {
	readonly failure: PublicKnownArchiveRemoteFailure;
}): React.JSX.Element {
	const sameOrganization = failure.sameOrganizationVerifiedCopies;
	const network = failure.networkVerifiedCopies;
	const total = sameOrganization.count + network.count;

	if (total === 0) {
		return (
			<span className="muted-inline">No verified alternate copy found</span>
		);
	}

	return (
		<div className="verified-alternate-copies">
			<strong>
				{formatInteger(total)} verified alternate{' '}
				{total === 1 ? 'copy' : 'copies'}
			</strong>
			<VerifiedCopyGroup label="Same organization" set={sameOrganization} />
			<VerifiedCopyGroup label="Other network source" set={network} />
		</div>
	);
}

type VerifiedCopySet =
	PublicKnownArchiveRemoteFailure['sameOrganizationVerifiedCopies'];

function VerifiedCopyGroup({
	label,
	set
}: {
	readonly label: string;
	readonly set: VerifiedCopySet;
}): React.JSX.Element | null {
	if (set.count === 0) return null;

	return (
		<div className="verified-copy-group">
			<span>
				{label} ({formatInteger(set.count)})
			</span>
			<ul>
				{set.copies.map((copy) => {
					const objectUrl = getVerifiedCopyObjectUrl(copy);
					const source = formatArchiveRoot(copy.archiveUrl);
					return (
						<li key={copy.remoteId}>
							{objectUrl === null ? (
								<span>{source}</span>
							) : (
								<a href={objectUrl} rel="noopener noreferrer" target="_blank">
									{source}
								</a>
							)}
							{copy.verifiedAt ? (
								<small>Verified {formatDateTime(copy.verifiedAt)}</small>
							) : null}
						</li>
					);
				})}
			</ul>
			{set.count > set.copies.length ? (
				<small>
					+{formatInteger(set.count - set.copies.length)} more verified
				</small>
			) : null}
		</div>
	);
}

export function ArchiveSourceLink({
	archiveUrl,
	children
}: {
	readonly archiveUrl: unknown;
	readonly children: React.ReactNode;
}): React.JSX.Element {
	const url = getHttpUrl(archiveUrl);
	if (url === null) return <span>{children}</span>;
	return <Link href={getArchiveScanDetailPath(url)}>{children}</Link>;
}

export function EvidenceTableRegion({
	children,
	className = '',
	label
}: {
	readonly children: React.ReactNode;
	readonly className?: string;
	readonly label: string;
}): React.JSX.Element {
	return (
		<div
			aria-label={label}
			className={`responsive-table known-evidence-table-wrap ${className}`.trim()}
			role="region"
			tabIndex={0}
		>
			{children}
		</div>
	);
}

export function EmptyEvidenceRow({
	text
}: {
	readonly text: string;
}): React.JSX.Element {
	return <p className="known-evidence-empty">{text}</p>;
}

export function formatObjectError(object: PublicHistoryArchiveObject): string {
	if (object.error === null) return 'Remote verification failed';
	const status = object.error.httpStatus
		? `HTTP ${object.error.httpStatus}; `
		: '';
	return `${status}${sanitizeEvidenceMessage(object.error.message)}`;
}

export function formatObjectStatus(object: PublicHistoryArchiveObject): string {
	if (object.status === 'scanning') return 'Checking';
	if (object.status === 'pending') return 'Waiting';
	return object.status.charAt(0).toUpperCase() + object.status.slice(1);
}

export function formatObjectStatusDetail(
	object: PublicHistoryArchiveObject
): string | null {
	if (object.delayReason !== null) {
		const label = archiveDelayReasonLabel(object.delayReason.code);
		if (label === null) return null;
		return object.delayReason.until === null
			? label
			: `${label} until ${formatDateTime(object.delayReason.until)}`;
	}
	if (object.workerStage) {
		const stage = formatWorkerStage(object.workerStage);
		return isRedundantStatusDetail(object, stage) ? null : stage;
	}
	return object.error ? sanitizeEvidenceMessage(object.error.message) : null;
}

function archiveDelayReasonLabel(
	code: NonNullable<PublicHistoryArchiveObject['delayReason']>['code']
): string | null {
	const labels = {
		'archive-active-cap': 'Waiting for this archive source',
		'global-active-cap': 'Waiting for a scanner slot',
		'host-active-cap': 'Waiting for this host',
		'host-backoff': 'Archive source temporarily paused',
		'legacy-deferred': 'Queued for verification',
		'missing-dependency': 'Waiting for a prerequisite file',
		'object-already-active': null,
		'planning-deferred': 'Queued for verification',
		'retry-window': 'Retry scheduled'
	} as const satisfies Record<
		NonNullable<PublicHistoryArchiveObject['delayReason']>['code'],
		string | null
	>;
	return labels[code];
}

function isRedundantStatusDetail(
	object: PublicHistoryArchiveObject,
	stage: string
): boolean {
	const normalizedStage = stage.toLocaleLowerCase('en-US');
	if (object.status === 'pending') {
		return normalizedStage === 'pending' || normalizedStage === 'waiting';
	}
	if (object.status === 'scanning') {
		return normalizedStage === 'scanning' || normalizedStage === 'checking';
	}
	return normalizedStage === object.status;
}

export function formatEvidenceClass(value: string): string {
	if (value === 'archive-object') return 'Remote archive';
	if (value === 'worker-infrastructure') return 'Worker infrastructure';
	return 'Coordinator infrastructure';
}

export function formatEventType(value: string): string {
	return formatMachineLabel(value);
}

export function formatWorkerStage(value: string | null): string {
	return value === null ? 'Not reported' : formatMachineLabel(value);
}

export function ArchiveStateSummary({
	root
}: {
	readonly root: PublicKnownArchiveRootEvidence;
}): React.JSX.Element {
	const state = root.scannerOwnedState;
	if (state === null) return <span>Not captured</span>;
	const successfulAt = state.metadata?.observedAt ?? state.observedAt;
	const failureAge = classifyArchiveRefreshFailure(state);

	return (
		<>
			<strong>{formatMachineLabel(state.status)}</strong>
			<small>Last stored state {formatDateTime(successfulAt)}</small>
			{state.latestFailure && failureAge ? (
				<small
					className={
						failureAge === 'historical' ? '' : 'known-evidence-warning'
					}
				>
					{archiveRefreshFailureLabel(failureAge)}{' '}
					{formatDateTime(state.latestFailure.observedAt)}:{' '}
					{formatMachineLabel(state.latestFailure.type)}
				</small>
			) : null}
		</>
	);
}

export function formatBytes(value: number | null): string {
	if (value === null) return 'Not reported';
	if (value < 1024) return `${formatInteger(value)} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
	return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

export function sanitizeEvidenceMessage(value: string): string {
	return value.replace(
		/(?:file:\/\/)?\/(?:home|var|tmp|etc|opt|srv|mnt|root|usr)\/[^\s'"<>)]*/g,
		'[internal path]'
	);
}

function formatMachineLabel(value: string): string {
	const label = value.replaceAll('_', ' ').replaceAll('-', ' ').trim();
	return label.length === 0
		? 'Not reported'
		: label.charAt(0).toUpperCase() + label.slice(1);
}

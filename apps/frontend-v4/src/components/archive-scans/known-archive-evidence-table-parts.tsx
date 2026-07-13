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

export function VerifiedCopyLinks({
	failure,
	relation,
	verbose = false
}: {
	readonly failure: PublicKnownArchiveRemoteFailure;
	readonly relation: 'network' | 'same-organization';
	readonly verbose?: boolean;
}): React.JSX.Element {
	const set =
		relation === 'network'
			? failure.networkVerifiedCopies
			: failure.sameOrganizationVerifiedCopies;
	if (set.count === 0)
		return <span className="muted-inline">None verified</span>;
	return (
		<div className="verified-copy-links">
			{set.copies.map((copy) => {
				const objectUrl = getVerifiedCopyObjectUrl(copy);
				const source = formatArchiveRoot(copy.archiveUrl);
				return (
					<div className="verified-copy-link" key={copy.remoteId}>
						{objectUrl === null ? (
							<>
								<span>{source}</span>
								<small>No proven object URL</small>
							</>
						) : (
							<a href={objectUrl} rel="noopener noreferrer" target="_blank">
								{verbose ? 'Download verified file from ' : ''}
								{source}
							</a>
						)}
					</div>
				);
			})}
			{set.count > set.copies.length ? (
				<small>
					+{formatInteger(set.count - set.copies.length)} more verified
				</small>
			) : null}
		</div>
	);
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

export function ExternalEvidenceLink({
	children,
	href
}: {
	readonly children: React.ReactNode;
	readonly href: unknown;
}): React.JSX.Element {
	const url = getHttpUrl(href);
	if (url === null) return <span>{children}</span>;
	return (
		<a href={url} rel="noopener noreferrer" target="_blank">
			{children}
		</a>
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
	if (object.delayReason?.code === 'planning-deferred') {
		return 'deferred by scanner planning';
	}
	if (object.delayReason?.code === 'legacy-deferred') {
		return 'legacy row awaiting scanner planning metadata';
	}
	if (object.delayReason) {
		const label = object.delayReason.code.replaceAll('-', ' ');
		return object.delayReason.until === null
			? label
			: `${label} until ${formatDateTime(object.delayReason.until)}`;
	}
	if (object.workerStage) return object.workerStage;
	return object.error ? sanitizeEvidenceMessage(object.error.message) : null;
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

export function formatArchiveState(
	root: PublicKnownArchiveRootEvidence
): string {
	const state = root.scannerOwnedState;
	if (state === null) return 'Not captured';
	return `${state.status}; ${formatDateTime(state.observedAt)}`;
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

import { createHash } from 'node:crypto';
import { normalizeHistoryArchiveRootUrl } from 'shared';
import type { HistoryArchiveIntegrityFailureDetectedEvent } from '../event/Event.js';

export const archiveFindingChunkSize = 200;
export const archiveSourceFindingLimit = 100;
export const archiveNotificationFindingLimit = 200;

export interface ArchiveFinding {
	readonly key: string;
	readonly fingerprint: string;
	readonly observedAt: Date;
	readonly event: HistoryArchiveIntegrityFailureDetectedEvent;
}
export interface ArchiveDeliveryFinding extends ArchiveFinding {
	readonly generation: string;
}
export interface ArchiveFindingSnapshot {
	readonly key: string;
	readonly observedAt: Date;
	readonly observedFingerprint: string;
	readonly conflicted: boolean;
	readonly deliveredFingerprint: string | null;
	readonly deliveredObservationAt: Date | null;
}
export interface ArchiveSourcePlan {
	readonly subscriptionId: number;
	readonly userId: string;
	readonly sourceKey: string;
	readonly findings: readonly ArchiveDeliveryFinding[];
	readonly unmute: readonly {
		readonly id: number;
		readonly latestSendTime: Date;
	}[];
}
export interface ArchiveFindingStateRepository {
	prepare(
		userId: string,
		findings: readonly ArchiveFinding[]
	): Promise<readonly ArchiveSourcePlan[]>;
	acknowledge(plans: readonly ArchiveSourcePlan[]): Promise<void>;
}

export function archiveFinding(
	event: HistoryArchiveIntegrityFailureDetectedEvent
): ArchiveFinding {
	const data = event.data;
	const root = text(data.archiveUrl, 2048)
		? normalizeHistoryArchiveRootUrl(data.archiveUrl)
		: null;
	const rawCode =
		typeof data.failureCode === 'string' ? data.failureCode.trim() : '';
	if (
		root === null ||
		!text(data.objectType, 64) ||
		!text(data.objectKey, 512) ||
		!text(rawCode, 128)
	)
		throw new Error('Invalid structured archive finding');
	const bucket =
		data.bucketHash === null
			? null
			: typeof data.bucketHash === 'string' &&
				  /^[0-9a-f]{64}$/i.test(data.bucketHash)
				? data.bucketHash.toLowerCase()
				: undefined;
	const checkpoint = data.checkpointLedger;
	if (
		bucket === undefined ||
		(checkpoint !== null &&
			(!Number.isSafeInteger(checkpoint) || checkpoint < 0)) ||
		!Number.isFinite(event.time.getTime()) ||
		event.time.toISOString() !== data.evidenceObservedAt
	)
		throw new Error('Invalid structured archive finding');
	const code = rawCode.toLowerCase().replace(/-/g, '_');
	return {
		key: hash([
			'archive-finding-key',
			1,
			root,
			data.objectType,
			data.objectKey
		]),
		fingerprint: hash(['archive-failure', 1, code, bucket, checkpoint]),
		observedAt: event.time,
		event
	};
}

export function archiveFindingEligible(
	finding: ArchiveFinding,
	state: ArchiveFindingSnapshot,
	unmuted: boolean
): boolean {
	if (
		state.conflicted ||
		finding.observedAt.getTime() !== state.observedAt.getTime() ||
		finding.fingerprint !== state.observedFingerprint
	)
		return false;
	if (
		state.deliveredFingerprint === null ||
		state.deliveredObservationAt === null
	)
		return true;
	if (unmuted || state.deliveredFingerprint !== finding.fingerprint)
		return true;
	return (
		finding.observedAt.getTime() >
		state.deliveredObservationAt.getTime() + 24 * 60 * 60 * 1000
	);
}

function hash(tuple: readonly (string | number | null)[]): string {
	return createHash('sha256')
		.update(JSON.stringify(tuple), 'utf8')
		.digest('hex');
}
function text(value: unknown, limit: number): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= limit &&
		value.trim() === value &&
		!/[\u0000-\u001f\u007f]/u.test(value)
	);
}

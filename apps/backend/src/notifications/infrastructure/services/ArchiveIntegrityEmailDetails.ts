import { normalizeHistoryArchiveRootUrl } from 'shared';
import {
	Event,
	type EventData,
	HistoryArchiveIntegrityFailureDetectedEvent
} from '../../domain/event/Event.js';
import type { EventSourceId } from '../../domain/event/EventSourceId.js';

export interface ArchiveIntegrityEmailDetails {
	archiveRoot: string;
	objectKey: string;
	failureCode: string;
	observedAt: string;
	href: string;
}

export function archiveIntegrityEmailDetails(
	event: Event<EventData, EventSourceId>,
	frontendBaseUrl: string
): ArchiveIntegrityEmailDetails | null {
	if (!(event instanceof HistoryArchiveIntegrityFailureDetectedEvent))
		return null;
	if (
		event.data === null ||
		typeof event.data !== 'object' ||
		Array.isArray(event.data)
	)
		return null;
	const { archiveUrl, objectKey, failureCode, evidenceObservedAt } = event.data;
	if (
		!safeText(archiveUrl, 2048) ||
		!safeText(objectKey, 512) ||
		!safeText(failureCode, 128) ||
		!safeText(evidenceObservedAt, 32) ||
		!safeText(frontendBaseUrl, 2048)
	)
		return null;
	const archiveRoot = normalizeHistoryArchiveRootUrl(archiveUrl);
	if (archiveRoot === null) return null;
	const observation = new Date(evidenceObservedAt);
	if (
		!Number.isFinite(observation.getTime()) ||
		observation.toISOString() !== evidenceObservedAt
	)
		return null;

	try {
		const base = new URL(frontendBaseUrl);
		if (
			(base.protocol !== 'https:' && base.protocol !== 'http:') ||
			base.username !== '' ||
			base.password !== '' ||
			base.search !== '' ||
			base.hash !== ''
		)
			return null;
		// Match the existing frontend archive-scan-routes UTF-8 base64url contract.
		const encodedRoot = Buffer.from(archiveRoot, 'utf8').toString('base64url');
		base.pathname = `${base.pathname.replace(/\/+$/, '')}/archive-scans/${encodedRoot}`;
		return {
			archiveRoot,
			objectKey,
			failureCode,
			observedAt: evidenceObservedAt,
			href: base.toString()
		};
	} catch {
		return null;
	}
}

function safeText(value: unknown, maximumLength: number): value is string {
	return (
		typeof value === 'string' &&
		value.trim() === value &&
		value.length > 0 &&
		value.length <= maximumLength &&
		!/[\u0000-\u001f\u007f]/u.test(value)
	);
}

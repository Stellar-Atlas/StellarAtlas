import type { Request } from 'express';
import { query, type ValidationChain } from 'express-validator';
import type {
	HistoryArchiveObjectEventTypeV1,
	HistoryArchiveObjectEvidenceClassV1,
	HistoryArchiveObjectStatusV1,
	HistoryArchiveObjectTypeV1
} from 'shared';
import {
	InvalidArchiveEvidenceCursorError,
	InvalidArchiveEvidenceFilterError,
	maxArchiveEvidenceCopyLimit,
	maxArchiveEvidencePageLimit,
	type ArchiveEvidencePageOptions
} from '../../use-cases/get-known-archive-evidence/ArchiveEvidencePagination.js';

const objectTypes: readonly HistoryArchiveObjectTypeV1[] = [
	'history-archive-state',
	'checkpoint-state',
	'ledger',
	'transactions',
	'results',
	'scp',
	'bucket'
];
export const maxArchiveEvidenceCursorLength = 512;

export function archiveEvidencePageValidators(): ValidationChain[] {
	return [
		query('archiveUrl')
			.optional()
			.isURL({ protocols: ['http', 'https'], require_protocol: true }),
		limitValidator('copyLimit', 1, maxArchiveEvidenceCopyLimit),
		cursorValidator('eventCursor'),
		query('eventEvidenceClass')
			.optional()
			.isIn([
				'archive-object',
				'worker-infrastructure',
				'coordinator-infrastructure'
			]),
		limitValidator('eventLimit', 0, maxArchiveEvidencePageLimit),
		query('eventObjectType').optional().isIn(objectTypes),
		query('eventType')
			.optional()
			.isIn(['claimed', 'heartbeat', 'verified', 'failed', 'released']),
		cursorValidator('failureCursor'),
		limitValidator('failureLimit', 0, maxArchiveEvidencePageLimit),
		query('failureObjectType').optional().isIn(objectTypes),
		cursorValidator('objectCursor'),
		limitValidator('objectLimit', 0, maxArchiveEvidencePageLimit),
		query('objectStatus')
			.optional()
			.isIn(['pending', 'scanning', 'verified', 'failed']),
		query('objectType').optional().isIn(objectTypes),
		cursorValidator('workerIssueCursor'),
		limitValidator('workerIssueLimit', 0, maxArchiveEvidencePageLimit)
	];
}

export function parseArchiveEvidencePageOptions(
	req: Request
): ArchiveEvidencePageOptions {
	return {
		archiveUrl: stringQuery(req, 'archiveUrl'),
		copyLimit: numberQuery(req, 'copyLimit'),
		eventCursor: stringQuery(req, 'eventCursor'),
		eventEvidenceClass: evidenceClassQuery(req, 'eventEvidenceClass'),
		eventLimit: numberQuery(req, 'eventLimit'),
		eventObjectType: objectTypeQuery(req, 'eventObjectType'),
		eventType: eventTypeQuery(req, 'eventType'),
		failureCursor: stringQuery(req, 'failureCursor'),
		failureLimit: numberQuery(req, 'failureLimit'),
		failureObjectType: objectTypeQuery(req, 'failureObjectType'),
		objectCursor: stringQuery(req, 'objectCursor'),
		objectLimit: numberQuery(req, 'objectLimit'),
		objectStatus: objectStatusQuery(req, 'objectStatus'),
		objectType: objectTypeQuery(req, 'objectType'),
		workerIssueCursor: stringQuery(req, 'workerIssueCursor'),
		workerIssueLimit: numberQuery(req, 'workerIssueLimit')
	};
}

export function isArchiveEvidenceClientError(error: Error): boolean {
	return (
		error instanceof InvalidArchiveEvidenceCursorError ||
		error instanceof InvalidArchiveEvidenceFilterError
	);
}

function limitValidator(name: string, min: number, max: number): ValidationChain {
	return query(name).optional().isInt({ min, max });
}

function cursorValidator(name: string): ValidationChain {
	return query(name)
		.optional()
		.isString()
		.isLength({ min: 1, max: maxArchiveEvidenceCursorLength });
}

function stringQuery(req: Request, name: string): string | undefined {
	const value = req.query[name];
	return typeof value === 'string' ? value : undefined;
}

function numberQuery(req: Request, name: string): number | undefined {
	const value = stringQuery(req, name);
	return value === undefined ? undefined : Number(value);
}

function objectTypeQuery(
	req: Request,
	name: string
): HistoryArchiveObjectTypeV1 | undefined {
	const value = stringQuery(req, name);
	return objectTypes.find((candidate) => candidate === value);
}

function objectStatusQuery(
	req: Request,
	name: string
): HistoryArchiveObjectStatusV1 | undefined {
	const value = stringQuery(req, name);
	if (
		value === 'pending' ||
		value === 'scanning' ||
		value === 'verified' ||
		value === 'failed'
	) {
		return value;
	}
	return undefined;
}

function eventTypeQuery(
	req: Request,
	name: string
): HistoryArchiveObjectEventTypeV1 | undefined {
	const value = stringQuery(req, name);
	if (
		value === 'claimed' ||
		value === 'heartbeat' ||
		value === 'verified' ||
		value === 'failed' ||
		value === 'released'
	) {
		return value;
	}
	return undefined;
}

function evidenceClassQuery(
	req: Request,
	name: string
): HistoryArchiveObjectEvidenceClassV1 | undefined {
	const value = stringQuery(req, name);
	if (
		value === 'archive-object' ||
		value === 'worker-infrastructure' ||
		value === 'coordinator-infrastructure'
	) {
		return value;
	}
	return undefined;
}

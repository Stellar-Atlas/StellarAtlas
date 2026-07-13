'use server';

import { fetchHistoryArchiveObjectEvidenceForArchive } from '../../api/archive-scans-client';
import {
	fetchKnownNodeArchiveEvidence,
	fetchKnownOrganizationArchiveEvidence,
	type KnownArchiveEvidenceQuery
} from '../../api/known-network-client';
import type {
	PublicHistoryArchiveObjectEventPage,
	PublicHistoryArchiveObjectPage,
	PublicKnownArchiveEvidence,
	PublicKnownArchiveRemoteFailurePage,
	PublicKnownArchiveWorkerIssuePage
} from '../../api/archive-evidence-types';
import {
	archiveEvidenceCopyLimit,
	archiveEvidencePageLimit,
	archiveObjectTypes,
	hasControlCharacters,
	toKnownArchiveEvidence
} from '../../domain/known-archive-evidence';
import {
	eventQuerySignature,
	failureQuerySignature,
	objectQuerySignature,
	type ArchiveEvidenceActionResult,
	type ArchiveEvidenceEventPageRequest,
	type ArchiveEvidenceEventQuery,
	type ArchiveEvidenceFailurePageRequest,
	type ArchiveEvidenceFailureQuery,
	type ArchiveEvidenceObjectPageRequest,
	type ArchiveEvidenceObjectQuery,
	type ArchiveEvidenceSubject
} from '../../domain/known-archive-evidence-request';

export interface ArchiveEvidenceFailurePages {
	readonly remoteFailures: PublicKnownArchiveRemoteFailurePage;
	readonly workerIssues: PublicKnownArchiveWorkerIssuePage;
}

export type ArchiveEvidenceAggregate = Pick<
	PublicKnownArchiveEvidence,
	'generatedAt' | 'nodePublicKeys' | 'roots' | 'totals'
>;

export async function loadKnownArchiveAggregate(request: {
	readonly requestGeneration: number;
	readonly subject: ArchiveEvidenceSubject;
}): Promise<ArchiveEvidenceActionResult<ArchiveEvidenceAggregate>> {
	let requestGeneration: number;
	let subject: ArchiveEvidenceSubject;
	try {
		requestGeneration = readGeneration(request.requestGeneration);
		subject = readSubject(request);
	} catch {
		return actionFailure(-1, 'invalid', 'Invalid archive evidence request.');
	}
	const querySignature = JSON.stringify({
		kind: 'aggregate',
		subject,
		version: 1
	});
	try {
		const evidence = await fetchEvidence(subject, {
			copyLimit: 1,
			eventLimit: 0,
			failureLimit: 0,
			objectLimit: 0,
			workerIssueLimit: 0
		});
		if (evidence === null) {
			return actionFailure(
				requestGeneration,
				'unavailable',
				'Archive evidence is unavailable.',
				querySignature
			);
		}
		return {
			data: {
				generatedAt: evidence.generatedAt,
				nodePublicKeys: evidence.nodePublicKeys,
				roots: evidence.roots,
				totals: evidence.totals
			},
			evidenceGeneratedAt: evidence.generatedAt,
			message: null,
			querySignature,
			requestGeneration,
			status: 'loaded'
		};
	} catch {
		return actionFailure(
			requestGeneration,
			'unavailable',
			'Archive evidence refresh failed.',
			querySignature
		);
	}
}

export async function loadKnownArchiveFailurePages(
	request: ArchiveEvidenceFailurePageRequest
): Promise<ArchiveEvidenceActionResult<ArchiveEvidenceFailurePages>> {
	return runArchiveEvidenceAction(
		() => readFailureContext(request),
		(context) => ({
			archiveUrl: context.query.archiveUrl ?? undefined,
			copyLimit: archiveEvidenceCopyLimit,
			eventLimit: 0,
			failureCursor: readCursor(request.failureCursor),
			failureLimit: archiveEvidencePageLimit,
			failureObjectType: context.query.objectType ?? undefined,
			objectLimit: 0,
			workerIssueCursor: readCursor(request.workerIssueCursor),
			workerIssueLimit: archiveEvidencePageLimit
		}),
		(evidence) => ({
			remoteFailures: evidence.remoteFailures,
			workerIssues: evidence.workerIssues
		}),
		request
	);
}

export async function loadKnownArchiveObjectPage(
	request: ArchiveEvidenceObjectPageRequest
): Promise<ArchiveEvidenceActionResult<PublicHistoryArchiveObjectPage>> {
	return runArchiveEvidenceAction(
		() => readObjectContext(request),
		(context) => ({
			archiveUrl: context.query.archiveUrl ?? undefined,
			eventLimit: 0,
			failureLimit: 0,
			objectCursor: readCursor(request.cursor),
			objectLimit: archiveEvidencePageLimit,
			objectStatus: context.query.status,
			objectType: context.query.objectType ?? undefined,
			workerIssueLimit: 0
		}),
		(evidence) => evidence.objectPage,
		request
	);
}

export async function loadKnownArchiveEventPage(
	request: ArchiveEvidenceEventPageRequest
): Promise<ArchiveEvidenceActionResult<PublicHistoryArchiveObjectEventPage>> {
	return runArchiveEvidenceAction(
		() => readEventContext(request),
		(context) => ({
			archiveUrl: context.query.archiveUrl ?? undefined,
			eventCursor: readCursor(request.cursor),
			eventEvidenceClass: context.query.evidenceClass ?? undefined,
			eventLimit: archiveEvidencePageLimit,
			eventObjectType: context.query.objectType ?? undefined,
			failureLimit: 0,
			objectLimit: 0,
			workerIssueLimit: 0
		}),
		(evidence) => evidence.eventPage,
		request
	);
}

type KnownArchiveEvidence = PublicKnownArchiveEvidence;

interface ActionContext<Query> {
	readonly query: Query;
	readonly querySignature: string;
	readonly requestGeneration: number;
	readonly subject: ArchiveEvidenceSubject;
}

async function runArchiveEvidenceAction<Request, Query, Data>(
	readContext: () => ActionContext<Query>,
	toBackendQuery: (context: ActionContext<Query>) => KnownArchiveEvidenceQuery,
	select: (evidence: KnownArchiveEvidence) => Data,
	request: Request
): Promise<ArchiveEvidenceActionResult<Data>> {
	let context: ActionContext<Query>;
	let backendQuery: KnownArchiveEvidenceQuery;
	try {
		context = readContext();
		backendQuery = toBackendQuery(context);
	} catch {
		return actionFailure(
			readGenerationOrInvalid(request),
			'invalid',
			'Invalid archive evidence request.'
		);
	}

	try {
		const evidence = await fetchEvidence(context.subject, backendQuery);
		if (evidence === null) {
			return actionFailure(
				context.requestGeneration,
				'unavailable',
				'Archive evidence is unavailable.',
				context.querySignature
			);
		}
		return {
			data: select(evidence),
			evidenceGeneratedAt: evidence.generatedAt,
			message: null,
			querySignature: context.querySignature,
			requestGeneration: context.requestGeneration,
			status: 'loaded'
		};
	} catch {
		return actionFailure(
			context.requestGeneration,
			'unavailable',
			'Archive evidence request failed.',
			context.querySignature
		);
	}
}

function readFailureContext(
	request: ArchiveEvidenceFailurePageRequest
): ActionContext<ArchiveEvidenceFailureQuery> {
	const subject = readSubject(request);
	const query = {
		archiveUrl: readArchiveUrl(request.archiveUrl),
		objectType: readObjectType(request.objectType)
	};
	return {
		query,
		querySignature: failureQuerySignature(subject, query),
		requestGeneration: readGeneration(request.requestGeneration),
		subject
	};
}

function readObjectContext(
	request: ArchiveEvidenceObjectPageRequest
): ActionContext<ArchiveEvidenceObjectQuery> {
	const subject = readSubject(request);
	const query = {
		archiveUrl: readArchiveUrl(request.archiveUrl),
		objectType: readObjectType(request.objectType),
		status: readEnum(request.status, [
			'pending',
			'scanning',
			'verified',
			'failed'
		])
	};
	return {
		query,
		querySignature: objectQuerySignature(subject, query),
		requestGeneration: readGeneration(request.requestGeneration),
		subject
	};
}

function readEventContext(
	request: ArchiveEvidenceEventPageRequest
): ActionContext<ArchiveEvidenceEventQuery> {
	const subject = readSubject(request);
	const query = {
		archiveUrl: readArchiveUrl(request.archiveUrl),
		evidenceClass: readNullableEnum(request.evidenceClass, [
			'archive-object',
			'worker-infrastructure',
			'coordinator-infrastructure'
		]),
		objectType: readObjectType(request.objectType)
	};
	return {
		query,
		querySignature: eventQuerySignature(subject, query),
		requestGeneration: readGeneration(request.requestGeneration),
		subject
	};
}

function fetchEvidence(
	subject: ArchiveEvidenceSubject,
	query: KnownArchiveEvidenceQuery
): Promise<KnownArchiveEvidence | null> {
	const options = { cache: 'no-store' } as const;
	if (subject.kind === 'node') {
		return fetchKnownNodeArchiveEvidence(subject.id, query, options);
	}
	if (subject.kind === 'organization') {
		return fetchKnownOrganizationArchiveEvidence(subject.id, query, options);
	}
	return fetchHistoryArchiveObjectEvidenceForArchive(
		subject.id,
		query,
		options
	).then(toKnownArchiveEvidence);
}

function readSubject(value: unknown): ArchiveEvidenceSubject {
	if (!isRecord(value) || !isRecord(value.subject)) throw invalidInput();
	const { id, kind } = value.subject;
	if (kind === 'archive') {
		const archiveUrl = readArchiveUrl(id);
		if (archiveUrl === null) throw invalidInput();
		return { id: archiveUrl, kind };
	}
	if (
		(kind !== 'node' && kind !== 'organization') ||
		typeof id !== 'string' ||
		id.length < 1 ||
		id.length > 256 ||
		id.trim() !== id ||
		hasControlCharacters(id)
	) {
		throw invalidInput();
	}
	return { id, kind };
}

function readArchiveUrl(value: unknown): string | null {
	if (value === null) return null;
	if (
		typeof value !== 'string' ||
		value.length > 2048 ||
		value.trim() !== value ||
		hasControlCharacters(value)
	) {
		throw invalidInput();
	}
	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw invalidInput();
		}
		return value;
	} catch (error) {
		if (error instanceof InvalidArchiveEvidenceActionInputError) throw error;
		throw invalidInput();
	}
}

function readGeneration(value: unknown): number {
	if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1) {
		throw invalidInput();
	}
	return value;
}

function readGenerationOrInvalid(value: unknown): number {
	if (!isRecord(value)) return -1;
	const generation = value.requestGeneration;
	return typeof generation === 'number' && Number.isSafeInteger(generation)
		? generation
		: -1;
}

function readCursor(value: unknown): string | undefined {
	if (value === null) return undefined;
	if (typeof value !== 'string' || value.length < 1 || value.length > 1024) {
		throw invalidInput();
	}
	return value;
}

function readObjectType(value: unknown) {
	return readNullableEnum(value, archiveObjectTypes);
}

function readNullableEnum<Value extends string>(
	value: unknown,
	allowed: readonly Value[]
): Value | null {
	if (value === null) return null;
	return readEnum(value, allowed);
}

function readEnum<Value extends string>(
	value: unknown,
	allowed: readonly Value[]
): Value {
	const match = allowed.find((candidate) => candidate === value);
	if (match === undefined) throw invalidInput();
	return match;
}

function actionFailure(
	requestGeneration: number,
	status: 'invalid' | 'unavailable',
	message: string,
	querySignature = 'invalid'
): ArchiveEvidenceActionResult<never> {
	return {
		data: null,
		evidenceGeneratedAt: null,
		message,
		querySignature,
		requestGeneration,
		status
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function invalidInput(): InvalidArchiveEvidenceActionInputError {
	return new InvalidArchiveEvidenceActionInputError();
}

class InvalidArchiveEvidenceActionInputError extends Error {}

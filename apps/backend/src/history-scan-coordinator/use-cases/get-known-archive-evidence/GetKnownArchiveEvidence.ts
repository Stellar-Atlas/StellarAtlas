import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type {
	KnownArchiveCheckpointCountsV1,
	KnownArchiveEvidenceV1,
	KnownArchiveObjectCountsV1,
	KnownArchiveVerifiedCopySetV1
} from 'shared';
import type {
	KnownArchiveEvidenceRepository,
	KnownArchiveRootScope,
	KnownArchiveVerifiedCopySetReadModel
} from '../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapHistoryArchiveStateSnapshot } from '../../infrastructure/mappers/mapHistoryArchiveStateSnapshot.js';
import { mapHistoryArchiveObject } from '../../infrastructure/mappers/mapHistoryArchiveObject.js';
import { mapHistoryArchiveObjectEvent } from '../../infrastructure/mappers/mapHistoryArchiveObjectEvent.js';
import {
	mapPublicArchiveState,
	mapPublicArchiveUrl
} from '../../infrastructure/mappers/PublicArchiveObjectFactsMapper.js';
import {
	encodeArchiveEvidenceCursor,
	InvalidArchiveEvidenceCursorError,
	InvalidArchiveEvidenceFilterError,
	normalizeArchiveEvidencePages,
	type ArchiveEvidencePageOptions
} from './ArchiveEvidencePagination.js';
import { ArchiveEvidenceCursorCodec } from './ArchiveEvidenceCursorCodec.js';

export interface OwnedKnownArchiveRoot extends KnownArchiveRootScope {
	readonly nodePublicKeys: readonly string[];
}

export interface GetKnownArchiveEvidenceInput {
	readonly fixedArchiveUrlIdentity?: string | null;
	readonly nodePublicKeys: readonly string[];
	readonly options: ArchiveEvidencePageOptions;
	readonly roots: readonly OwnedKnownArchiveRoot[];
	readonly sameOrganizationArchiveUrlIdentities: readonly string[];
}

@injectable()
export class GetKnownArchiveEvidence {
	constructor(
		@inject(TYPES.KnownArchiveEvidenceRepository)
		private readonly repository: KnownArchiveEvidenceRepository,
		@inject('ExceptionLogger')
		private readonly exceptionLogger: ExceptionLogger,
		@inject(TYPES.ArchiveEvidenceCursorCodec)
		private readonly cursorCodec: ArchiveEvidenceCursorCodec
	) {}

	async execute(
		input: GetKnownArchiveEvidenceInput
	): Promise<Result<KnownArchiveEvidenceV1, Error>> {
		try {
			const pages = normalizeArchiveEvidencePages(
				input.options,
				this.cursorCodec,
				input.fixedArchiveUrlIdentity ?? null,
				input.roots.map((root) => root.archiveUrlIdentity)
			);
			ensureArchiveFilterIsOwned(
				pages.objectPage.filters.archiveUrlIdentity,
				input
			);
			const readModel = await this.repository.findEvidence({
				copyLimit: pages.copyLimit,
				eventPage: pages.eventPage,
				objectPage: pages.objectPage,
				remoteFailures: pages.remoteFailures,
				roots: input.roots,
				sameOrganizationArchiveUrlIdentities:
					input.sameOrganizationArchiveUrlIdentities,
				snapshotAt: pages.snapshotAt,
				workerIssues: pages.workerIssues
			});
			const generatedAt = pages.snapshotAt;
			const nodePublicKeys = [...new Set(input.nodePublicKeys)].toSorted();
			const rootsByIdentity = new Map(
				input.roots.map((root) => [root.archiveUrlIdentity, root])
			);
			const roots = readModel.roots.map((root) => ({
				archiveUrl: mapPublicArchiveUrl(root.archiveUrl),
				archiveUrlIdentity: mapPublicArchiveUrl(root.archiveUrlIdentity),
				checkpoints: root.checkpoints,
				latestObjectAt: root.latestObjectAt?.toISOString() ?? null,
				nodePublicKeys:
					rootsByIdentity.get(root.archiveUrlIdentity)?.nodePublicKeys ?? [],
				objects: root.objects,
				scannerOwnedState:
					root.scannerOwnedState === null
						? null
						: mapPublicArchiveState(
								mapHistoryArchiveStateSnapshot(root.scannerOwnedState)
							)
			}));
			const objectRows = readModel.objectPage.objects.slice(
				0,
				pages.objectPage.limit
			);
			const eventRows = readModel.eventPage.events.slice(
				0,
				pages.eventPage.limit
			);
			const failureRows = readModel.remoteFailures.failures.slice(
				0,
				pages.remoteFailures.limit
			);
			const workerRows = readModel.workerIssues.failures.slice(
				0,
				pages.workerIssues.limit
			);
			const copyCoverage = new Map(
				readModel.copyCoverage.map((coverage) => [
					coverage.sourceRemoteId,
					coverage
				])
			);

			return ok({
				eventPage: {
					events: eventRows.map(mapHistoryArchiveObjectEvent),
					filters: pages.eventPage.filters,
					page: createPageMetadata(
						readModel.eventPage.events,
						pages.eventPage.limit,
						readModel.eventPage.total,
						'events',
						pages.eventPage.filters,
						(event) => ({
							at: requireDate(event.createdAt),
							remoteId: event.remoteId
						}),
						pages.cursorScope,
						this.cursorCodec,
						pages.snapshotAt
					)
				},
				generatedAt: generatedAt.toISOString(),
				nodePublicKeys,
				objectPage: {
					filters: pages.objectPage.filters,
					objects: objectRows.map(mapHistoryArchiveObject),
					page: createPageMetadata(
						readModel.objectPage.objects,
						pages.objectPage.limit,
						readModel.objectPage.total,
						'objects',
						pages.objectPage.filters,
						(object) => ({
							at: requireDate(object.createdAt),
							remoteId: object.remoteId
						}),
						pages.cursorScope,
						this.cursorCodec,
						pages.snapshotAt
					)
				},
				remoteFailures: {
					filters: pages.remoteFailures.filters,
					failures: failureRows.map((failure) => {
						const coverage = copyCoverage.get(failure.object.remoteId);
						return {
							networkVerifiedCopies: mapCopySet(
								coverage?.network,
								pages.copyLimit
							),
							object: mapHistoryArchiveObject(failure.object),
							sameOrganizationVerifiedCopies: mapCopySet(
								coverage?.sameOrganization,
								pages.copyLimit
							)
						};
					}),
					...createFlatPageMetadata(
						readModel.remoteFailures.failures,
						pages.remoteFailures.limit,
						readModel.remoteFailures.total,
						'remote-failures',
						pages.remoteFailures.filters,
						pages.cursorScope,
						this.cursorCodec,
						pages.snapshotAt
					)
				},
				roots,
				totals: {
					archiveRoots: roots.length,
					checkpoints: sumCheckpointCounts(
						roots.map((root) => root.checkpoints)
					),
					nodes: nodePublicKeys.length,
					objects: sumObjectCounts(roots.map((root) => root.objects))
				},
				workerIssues: {
					filters: pages.workerIssues.filters,
					issues: workerRows.map((failure) => ({
						evidenceClass: requireInfrastructureClass(failure.evidenceClass),
						object: mapHistoryArchiveObject(failure.object)
					})),
					...createFlatPageMetadata(
						readModel.workerIssues.failures,
						pages.workerIssues.limit,
						readModel.workerIssues.total,
						'worker-issues',
						pages.workerIssues.filters,
						pages.cursorScope,
						this.cursorCodec,
						pages.snapshotAt
					)
				}
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			if (
				!(mappedError instanceof InvalidArchiveEvidenceCursorError) &&
				!(mappedError instanceof InvalidArchiveEvidenceFilterError)
			) {
				this.exceptionLogger.captureException(mappedError);
			}
			return err(mappedError);
		}
	}
}

function createPageMetadata<T>(
	rows: readonly T[],
	limit: number,
	total: number,
	kind: 'events' | 'objects' | 'remote-failures' | 'worker-issues',
	filters: object,
	toCursor: (row: T) => { readonly at: Date; readonly remoteId: string },
	cursorScope: readonly string[],
	cursorCodec: ArchiveEvidenceCursorCodec,
	snapshotAt: Date
) {
	const pageRows = rows.slice(0, limit);
	const hasMore = rows.length > limit;
	const last = pageRows.at(-1);
	return {
		hasMore,
		limit,
		nextCursor:
			hasMore && last !== undefined
				? encodeArchiveEvidenceCursor(
						cursorCodec,
						kind,
						filters,
						toCursor(last),
						cursorScope
					)
				: null,
		snapshotAt: snapshotAt.toISOString(),
		total
	};
}

function createFlatPageMetadata(
	rows: readonly {
		readonly object: { readonly createdAt?: Date; readonly remoteId: string };
	}[],
	limit: number,
	total: number,
	kind: 'remote-failures' | 'worker-issues',
	filters: object,
	cursorScope: readonly string[],
	cursorCodec: ArchiveEvidenceCursorCodec,
	snapshotAt: Date
) {
	return createPageMetadata(
		rows,
		limit,
		total,
		kind,
		filters,
		(row) => ({
			at: requireDate(row.object.createdAt),
			remoteId: row.object.remoteId
		}),
		cursorScope,
		cursorCodec,
		snapshotAt
	);
}

function ensureArchiveFilterIsOwned(
	archiveUrlIdentity: string | null,
	input: GetKnownArchiveEvidenceInput
): void {
	if (
		archiveUrlIdentity !== null &&
		!input.roots.some((root) => root.archiveUrlIdentity === archiveUrlIdentity)
	) {
		throw new InvalidArchiveEvidenceFilterError();
	}
}

function mapCopySet(
	set: KnownArchiveVerifiedCopySetReadModel | undefined,
	sampleLimit: number
): KnownArchiveVerifiedCopySetV1 {
	return {
		copies: (set?.copies ?? []).map((copy) => ({
			archiveUrl: mapPublicArchiveUrl(copy.archiveUrl),
			archiveUrlIdentity: mapPublicArchiveUrl(copy.archiveUrlIdentity),
			objectUrl: requirePublicObjectUrl(copy.objectUrl),
			remoteId: copy.remoteId,
			verifiedAt: copy.verifiedAt?.toISOString() ?? null
		})),
		count: set?.count ?? 0,
		sampleLimit
	};
}

function requirePublicObjectUrl(value: string): string {
	const mapped = mapPublicArchiveUrl(value);
	if (mapped !== '[redacted]') return mapped;
	throw new Error('Verified archive copy has an invalid public object URL');
}

function requireInfrastructureClass(value: string) {
	if (
		value === 'worker-infrastructure' ||
		value === 'coordinator-infrastructure'
	) {
		return value;
	}
	throw new Error('Remote archive evidence leaked into worker issues');
}

function requireDate(value: Date | undefined): Date {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
	throw new Error('Archive evidence page row is missing its cursor date');
}

function sumObjectCounts(
	counts: readonly KnownArchiveObjectCountsV1[]
): KnownArchiveObjectCountsV1 {
	return counts.reduce(
		(total, current) => ({
			activeObjects: total.activeObjects + current.activeObjects,
			bucketObjects: total.bucketObjects + current.bucketObjects,
			pendingObjects: total.pendingObjects + current.pendingObjects,
			remoteFailureObjects:
				total.remoteFailureObjects + current.remoteFailureObjects,
			totalObjects: total.totalObjects + current.totalObjects,
			verifiedBucketObjects:
				total.verifiedBucketObjects + current.verifiedBucketObjects,
			verifiedObjects: total.verifiedObjects + current.verifiedObjects,
			workerIssueObjects: total.workerIssueObjects + current.workerIssueObjects
		}),
		{
			activeObjects: 0,
			bucketObjects: 0,
			pendingObjects: 0,
			remoteFailureObjects: 0,
			totalObjects: 0,
			verifiedBucketObjects: 0,
			verifiedObjects: 0,
			workerIssueObjects: 0
		}
	);
}

function sumCheckpointCounts(
	counts: readonly KnownArchiveCheckpointCountsV1[]
): KnownArchiveCheckpointCountsV1 {
	return counts.reduce(
		(total, current) => ({
			mismatchedCheckpoints:
				total.mismatchedCheckpoints + current.mismatchedCheckpoints,
			notEvaluableCheckpoints:
				total.notEvaluableCheckpoints + current.notEvaluableCheckpoints,
			pendingCheckpoints: total.pendingCheckpoints + current.pendingCheckpoints,
			totalCheckpoints: total.totalCheckpoints + current.totalCheckpoints,
			verifiedCheckpoints:
				total.verifiedCheckpoints + current.verifiedCheckpoints
		}),
		{
			mismatchedCheckpoints: 0,
			notEvaluableCheckpoints: 0,
			pendingCheckpoints: 0,
			totalCheckpoints: 0,
			verifiedCheckpoints: 0
		}
	);
}

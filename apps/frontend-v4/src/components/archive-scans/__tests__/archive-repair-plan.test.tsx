/// <reference types="jest" />

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicHistoryArchiveRepairPlan } from '../../../api/archive-repair-types';
import type { PublicKnownArchiveEvidence } from '../../../domain/known-archive-evidence';
import { NodeArchiveRepairPlan } from '../../nodes/node-archive-repair-plan';
import { getValidatedArchiveRelativePath } from '../../nodes/node-archive-repair-workflow';
import { RepairView } from '../known-archive-evidence-views';

describe('archive repair plan', () => {
	it('accepts only a traversal-safe path below the same archive root', () => {
		expect(
			getValidatedArchiveRelativePath(
				'https://archive.example/history',
				'https://archive.example/history/history/03/c6/94/history-03c6943f.json'
			)
		).toBe('history/03/c6/94/history-03c6943f.json');
		expect(
			getValidatedArchiveRelativePath(
				'https://archive.example/history',
				'https://other.example/history/file'
			)
		).toBeNull();
		expect(
			getValidatedArchiveRelativePath(
				'https://archive.example/history',
				'https://archive.example/history/%2e%2e/secret'
			)
		).toBeNull();
	});

	it('keeps endpoint candidates separate from proof-gated downloads', () => {
		const markup = renderToStaticMarkup(
			createElement(NodeArchiveRepairPlan, { repairPlan: createPlan() })
		);

		expect(markup).toContain('Confirmed repair evidence');
		expect(markup).toContain('Proof-bound source found; download pending');
		expect(markup).toContain('checkpoint 63 / proof 41 v10 / multi-source');
		expect(markup).toContain('Failed file');
		expect(markup).toContain('Finding');
		expect(markup).toContain('Confirmed archive repair evidence');
		expect(markup).toContain('data-label="Replacement"');
		expect(markup).not.toContain('Replace archive file');
		expect(markup).toContain(
			'Replace the transaction archive file for checkpoint 63.'
		);
		expect(markup).not.toContain('href=');
	});

	it('offers a proof-bound object only through verify-on-download', () => {
		const plan = createPlan();
		const action = requireAction(plan);
		const source = requireSource(action);
		const downloadUrl =
			'/v1/archive-scans/repair-artifacts/objects/' +
			`11111111-1111-4111-8111-111111111111/${Date.parse('2026-07-11T00:00:00.000Z')}/missing/${source.proof.candidateObjectRemoteId}/` +
			`${source.proof.proofId}/${source.proof.proofVersion}/` +
			`${Date.parse(source.proof.evaluatedAt)}/${source.proof.contentHash.digest}`;
		const artifact = {
			artifactType: 'transactions' as const,
			byteLength: null,
			contentHash: source.proof.contentHash,
			downloadUrl,
			mediaType: 'application/gzip' as const,
			objectIdentity: 'transactions:0000003f',
			provenAt: source.proof.evaluatedAt,
			status: 'verify-on-download' as const
		};
		const markup = renderToStaticMarkup(
			createElement(NodeArchiveRepairPlan, {
				repairPlan: {
					...plan,
					actions: [
						{
							...action,
							repairArtifact: artifact,
							repairManifest: createReadyManifest(action, artifact, source),
							severity: 'error'
						}
					]
				}
			})
		);

		expect(markup).toContain('Operator-authenticated verify and download');
		expect(markup).toContain(`href="${downloadUrl}"`);
		expect(markup).toContain('returns bytes only after their');
		expect(markup).toContain('Proof-bound operator workflow');
		expect(markup).toContain('hashes gunzipped bytes for XDR');
		expect(markup).toContain('verify-history-archive-repair-artifact.mjs');
		expect(markup).toContain('$CONTENT_REPRESENTATION');
		expect(markup).toContain('Copy guarded recheck command');
		expect(markup).toContain('disabled=""');
		expect(markup).toContain('Optional broader whole-archive remediation');
		expect(markup).toContain('manifest is not an Archivist input');
		expect(markup).not.toContain('candidate.example/history/transactions');
	});

	it('links only a locally proven replacement artifact', () => {
		const plan = createPlan();
		const action = requireAction(plan);
		const markup = renderToStaticMarkup(
			createElement(NodeArchiveRepairPlan, {
				repairPlan: {
					...plan,
					actions: [
						{
							...action,
							bucketHash: 'a'.repeat(64),
							repairArtifact: {
								artifactType: 'bucket',
								byteLength: 128,
								contentHash: {
									algorithm: 'sha256',
									digest: 'a'.repeat(64),
									representation: 'uncompressed-xdr'
								},
								downloadUrl:
									'/v1/archive-scans/repair-artifacts/buckets/' +
									'a'.repeat(64),
								mediaType: 'application/gzip',
								objectIdentity: `bucket:${'a'.repeat(64)}`,
								provenAt: '2026-07-11T00:00:00.000Z',
								status: 'available'
							},
							severity: 'error'
						}
					]
				}
			})
		);

		expect(markup).toContain('Operator-authenticated download');
		expect(markup).toContain(
			`href="/v1/archive-scans/repair-artifacts/buckets/${'a'.repeat(64)}"`
		);
		expect(markup).toContain('transactions/file.xdr.gz');
		expect(markup).toContain('Keep the existing object as a backup.');
		expect(markup).toContain('eligible for recheck after');
	});

	it('keeps the independent Archivist option reachable through the live repair view for a zero-action plan', () => {
		const emptyPlan: PublicHistoryArchiveRepairPlan = {
			...createPlan(),
			actionCount: 0,
			actions: [],
			infrastructureBlocks: [],
			limit: 50
		};
		const liveRepairViewMarkup = renderToStaticMarkup(
			createElement(RepairView, {
				repair: {
					archiveUrl: 'https://failed.example',
					changeArchiveUrl: () => undefined
				},
				roots: [createRepairRoot()]
			})
		);
		const loadedPlanMarkup = renderToStaticMarkup(
			createElement(NodeArchiveRepairPlan, { repairPlan: emptyPlan })
		);

		expect(liveRepairViewMarkup).toContain(
			'Loading confirmed repair evidence.'
		);
		expect(liveRepairViewMarkup).toContain('stellar-archivist repair');
		expect(liveRepairViewMarkup).toContain('stellar-archivist scan');
		expect(loadedPlanMarkup).toContain(
			'No proof-bound file action is currently available'
		);
		expect(loadedPlanMarkup).toContain('stellar-archivist repair');
		expect(loadedPlanMarkup).toContain('stellar-archivist scan');
		expect(loadedPlanMarkup).toContain('TARGET_ARCHIVE_ROOT_URL');
	});
});

function createRepairRoot(): PublicKnownArchiveEvidence['roots'][number] {
	return {
		archiveUrl: 'https://failed.example',
		archiveUrlIdentity: 'https://failed.example',
		checkpoints: {
			mismatchedCheckpoints: 0,
			notEvaluableCheckpoints: 0,
			pendingCheckpoints: 0,
			totalCheckpoints: 1,
			verifiedCheckpoints: 1
		},
		latestObjectAt: '2026-07-11T00:00:00.000Z',
		nodePublicKeys: ['GNODE'],
		objects: {
			activeObjects: 0,
			bucketObjects: 0,
			pendingObjects: 0,
			remoteFailureObjects: 1,
			totalObjects: 1,
			verifiedBucketObjects: 0,
			verifiedObjects: 0,
			workerIssueObjects: 0
		},
		scannerOwnedState: null
	};
}

function requireAction(
	plan: PublicHistoryArchiveRepairPlan
): PublicHistoryArchiveRepairPlan['actions'][number] {
	const action = plan.actions[0];
	if (action === undefined) throw new Error('Repair action fixture is missing');
	return action;
}

function requireSource(
	action: PublicHistoryArchiveRepairPlan['actions'][number]
): PublicHistoryArchiveRepairPlan['actions'][number]['knownGoodSources'][number] {
	const source = action.knownGoodSources[0];
	if (source === undefined) throw new Error('Repair source fixture is missing');
	return source;
}

function createPlan(): PublicHistoryArchiveRepairPlan {
	return {
		actionCount: 1,
		actions: [
			{
				actionId: 'replace-archive-file:11111111-1111-4111-8111-111111111111',
				bucketHash: null,
				checkpointEvidence: [],
				checkpointLedger: 63,
				evidence: [
					{
						archiveUrl: 'https://failed.example',
						archiveUrlIdentity: 'https://failed.example',
						bucketHash: null,
						checkpointLedger: 63,
						evidenceClass: 'archive-object',
						errorMessage: null,
						errorType: null,
						failureClass: 'not-found',
						httpStatus: 404,
						nextAttemptAt: '2026-07-11T00:05:00.000Z',
						objectKey: 'transactions:0000003f',
						objectType: 'transactions',
						objectUrl: 'https://failed.example/transactions/file.xdr.gz',
						observedCheckpointLedger: null,
						remoteId: '11111111-1111-4111-8111-111111111111',
						status: 'failed',
						updatedAt: '2026-07-11T00:00:00.000Z'
					}
				],
				kind: 'replace-archive-file',
				knownGoodSources: [
					{
						archiveUrl: 'https://candidate.example',
						archiveUrlIdentity: 'https://candidate.example',
						objectUrl: 'https://candidate.example/transactions/file.xdr.gz',
						proof: {
							anchor: {
								kind: 'multi-source',
								sourceCount: 2
							},
							candidateObjectRemoteId: '22222222-2222-4222-8222-222222222222',
							checkpointLedger: 63,
							contentHash: {
								algorithm: 'sha256',
								digest: 'a'.repeat(64),
								representation: 'uncompressed-xdr'
							},
							evaluatedAt: '2026-07-11T00:01:00.000Z',
							kind: 'strict-checkpoint',
							proofId: '41',
							proofVersion: 10
						},
						verifiedAt: '2026-07-11T00:00:00.000Z'
					}
				],
				reason: 'missing-object',
				repairArtifact: null,
				repairManifest: null,
				severity: 'blocked',
				summary: 'Replace the transaction archive file for checkpoint 63.'
			}
		],
		archiveUrl: 'https://failed.example',
		archiveUrlIdentity: 'https://failed.example',
		generatedAt: '2026-07-11T00:00:00.000Z',
		infrastructureBlocks: [],
		limit: 50,
		summary: {
			activeObjectChecks: 0,
			failedCheckpointProofs: 0,
			failedObjectChecks: 1,
			pendingObjectChecks: 0,
			verifiedObjectChecks: 0
		}
	};
}

function createReadyManifest(
	action: PublicHistoryArchiveRepairPlan['actions'][number],
	artifact: Extract<
		NonNullable<
			PublicHistoryArchiveRepairPlan['actions'][number]['repairArtifact']
		>,
		{ status: 'verify-on-download' }
	>,
	source: PublicHistoryArchiveRepairPlan['actions'][number]['knownGoodSources'][number]
): NonNullable<
	PublicHistoryArchiveRepairPlan['actions'][number]['repairManifest']
> {
	const evidence = action.evidence[0];
	if (evidence === undefined)
		throw new Error('Repair evidence fixture is missing');
	return {
		actionId: action.actionId,
		evidence,
		generatedAt: evidence.updatedAt,
		recheck: {
			endpoint: `/v1/archive-scans/objects/${evidence.remoteId}/recheck`,
			minimumEvidenceUpdatedAt: evidence.updatedAt,
			resolutionCondition: 'same-object-verified-after-original-evidence',
			targetRemoteId: evidence.remoteId
		},
		replacement: { artifact, source },
		schemaVersion: 1,
		status: 'ready',
		steps: [
			{
				backupSuffix: '.stellaratlas-backup',
				kind: 'backup-current-file',
				order: 1,
				required: false
			},
			{
				input: 'replacement-download-url',
				kind: 'stage-replacement',
				order: 2,
				required: true,
				stagingLocation: 'same-filesystem-temporary-file'
			},
			{
				expectedContentHash: artifact.contentHash,
				kind: 'verify-staged-content',
				order: 3,
				required: true
			},
			{
				kind: 'preserve-metadata',
				order: 4,
				preserve: ['owner', 'mode', 'acl'],
				required: true
			},
			{
				kind: 'atomic-replace',
				order: 5,
				required: true,
				requiresSameFilesystem: true
			},
			{
				kind: 'request-recheck',
				order: 6,
				required: true,
				resolutionCondition: 'same-object-verified-after-original-evidence'
			}
		],
		target: {
			archiveUrl: evidence.archiveUrl,
			archiveUrlIdentity: evidence.archiveUrlIdentity,
			bucketHash: evidence.bucketHash,
			checkpointLedger: evidence.checkpointLedger,
			objectKey: evidence.objectKey,
			objectType: evidence.objectType,
			objectUrl: evidence.objectUrl,
			operatorTargetPathRequired: true
		}
	};
}

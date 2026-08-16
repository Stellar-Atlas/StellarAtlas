/// <reference types="jest" />

import type { HistoryArchiveRepairPlanV1 } from 'shared';
import { fetchHistoryArchiveRepairPlanForArchive } from '../archive-scans-client';
import { parseHistoryArchiveRepairPlan } from '../history-archive-repair-plan-parser';

describe('history archive repair plan parser', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('accepts a proof-complete v1 repair plan', () => {
		const response = createRepairPlan();

		expect(parseHistoryArchiveRepairPlan(response)).toBe(response);
	});

	it('accepts a proof-bound replacement that is reverified on download', () => {
		const plan = createRepairPlan();
		const action = getFirstAction(plan);
		const source = getFirstSource(action);
		const artifact = {
			artifactType: 'transactions' as const,
			byteLength: null,
			contentHash: source.proof.contentHash,
			downloadUrl:
				'/v1/archive-scans/repair-artifacts/objects/' +
				'11111111-1111-4111-8111-111111111111/' +
				`${Date.parse(action.evidence[0]?.updatedAt ?? '')}/missing/` +
				`${source.proof.candidateObjectRemoteId}/${source.proof.proofId}/` +
				`${source.proof.proofVersion}/${Date.parse(source.proof.evaluatedAt)}/` +
				`${source.proof.contentHash.digest}`,
			mediaType: 'application/gzip' as const,
			objectIdentity: 'transactions:0000003f',
			provenAt: source.proof.evaluatedAt,
			status: 'verify-on-download' as const
		};
		const response: HistoryArchiveRepairPlanV1 = {
			...plan,
			actions: [
				{
					...action,
					repairArtifact: artifact,
					repairManifest: createReadyManifest(action, artifact, source),
					severity: 'error'
				}
			]
		};

		expect(parseHistoryArchiveRepairPlan(response)).toBe(response);
	});

	it('rejects a verify-on-download artifact that is not proof bound', () => {
		const plan = createRepairPlan();
		const action = getFirstAction(plan);
		const source = getFirstSource(action);
		const malformed = {
			...plan,
			actions: [
				{
					...action,
					repairArtifact: {
						artifactType: 'transactions',
						byteLength: null,
						contentHash: source.proof.contentHash,
						downloadUrl: source.objectUrl,
						mediaType: 'application/gzip',
						objectIdentity: 'transactions:0000003f',
						provenAt: source.proof.evaluatedAt,
						status: 'verify-on-download'
					}
				}
			]
		};

		expect(() => parseHistoryArchiveRepairPlan(malformed)).toThrow(
			/repairArtifact\/downloadUrl/
		);
	});

	it('rejects malformed proof digest and anchor evidence with useful paths', () => {
		const plan = createRepairPlan();
		const action = getFirstAction(plan);
		const source = getFirstSource(action);
		const malformed = {
			...plan,
			actions: [
				{
					...action,
					knownGoodSources: [
						{
							...source,
							proof: {
								...source.proof,
								anchor: { ...source.proof.anchor, sourceCount: 0 },
								contentHash: {
									...source.proof.contentHash,
									digest: 'not-a-sha256'
								}
							}
						}
					]
				}
			]
		};

		expect(() => parseHistoryArchiveRepairPlan(malformed)).toThrow(
			/knownGoodSources\/0\/proof\/(anchor\/sourceCount|contentHash\/digest)/
		);
	});

	it('fails closed when a rolling deploy returns a source without proof', async () => {
		const plan = createRepairPlan();
		const action = getFirstAction(plan);
		const source = getFirstSource(action);
		const rollingDeployResponse = {
			...plan,
			actions: [
				{
					...action,
					knownGoodSources: [
						{
							archiveUrl: source.archiveUrl,
							archiveUrlIdentity: source.archiveUrlIdentity,
							objectUrl: source.objectUrl,
							verifiedAt: source.verifiedAt
						}
					]
				}
			]
		};
		globalThis.fetch = async () => jsonResponse(rollingDeployResponse);

		await expect(
			fetchHistoryArchiveRepairPlanForArchive(
				'https://target.example/history',
				25
			)
		).rejects.toThrow(
			"response/actions/0/knownGoodSources/0 must have required property 'proof'"
		);
	});
});

function createRepairPlan(): HistoryArchiveRepairPlanV1 {
	return {
		actionCount: 1,
		actions: [
			{
				actionId: 'replace-archive-file:target-object',
				bucketHash: null,
				checkpointEvidence: [],
				checkpointLedger: 63,
				evidence: [
					{
						archiveUrl: 'https://target.example/history',
						archiveUrlIdentity: 'https://target.example/history',
						bucketHash: null,
						checkpointLedger: 63,
						evidenceClass: 'archive-object',
						errorMessage: 'Remote transaction file was not found',
						errorType: 'archive_http_error',
						failureClass: 'not-found',
						httpStatus: 404,
						nextAttemptAt: null,
						objectKey: 'transactions:0000003f',
						objectType: 'transactions',
						objectUrl:
							'https://target.example/history/transactions/00/00/00/transactions-0000003f.xdr.gz',
						observedCheckpointLedger: null,
						remoteId: '11111111-1111-4111-8111-111111111111',
						status: 'failed',
						updatedAt: '2026-07-19T00:00:00.000Z'
					}
				],
				kind: 'replace-archive-file',
				knownGoodSources: [
					{
						archiveUrl: 'https://source.example/history',
						archiveUrlIdentity: 'https://source.example/history',
						objectUrl:
							'https://source.example/history/transactions/00/00/00/transactions-0000003f.xdr.gz',
						proof: {
							anchor: { kind: 'multi-source', sourceCount: 2 },
							candidateObjectRemoteId: '22222222-2222-4222-8222-222222222222',
							checkpointLedger: 63,
							contentHash: {
								algorithm: 'sha256',
								digest: 'a'.repeat(64),
								representation: 'uncompressed-xdr'
							},
							evaluatedAt: '2026-07-19T00:01:00.000Z',
							kind: 'strict-checkpoint',
							proofId: '41',
							proofVersion: 7
						},
						verifiedAt: '2026-07-19T00:00:00.000Z'
					}
				],
				reason: 'missing-object',
				repairArtifact: null,
				repairManifest: null,
				severity: 'blocked',
				summary: 'Replace the missing transaction archive file.'
			}
		],
		archiveUrl: 'https://target.example/history',
		archiveUrlIdentity: 'https://target.example/history',
		generatedAt: '2026-07-19T00:02:00.000Z',
		infrastructureBlocks: [],
		limit: 25,
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
	action: HistoryArchiveRepairPlanV1['actions'][number],
	artifact: Extract<
		NonNullable<
			HistoryArchiveRepairPlanV1['actions'][number]['repairArtifact']
		>,
		{ status: 'verify-on-download' }
	>,
	source: HistoryArchiveRepairPlanV1['actions'][number]['knownGoodSources'][number]
): NonNullable<
	HistoryArchiveRepairPlanV1['actions'][number]['repairManifest']
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

function getFirstAction(
	plan: HistoryArchiveRepairPlanV1
): HistoryArchiveRepairPlanV1['actions'][number] {
	const action = plan.actions[0];
	if (action === undefined) throw new Error('Repair action fixture is missing');
	return action;
}

function getFirstSource(
	action: HistoryArchiveRepairPlanV1['actions'][number]
): HistoryArchiveRepairPlanV1['actions'][number]['knownGoodSources'][number] {
	const source = action.knownGoodSources[0];
	if (source === undefined) throw new Error('Repair source fixture is missing');
	return source;
}

function jsonResponse(payload: unknown): Response {
	return {
		json: async () => payload,
		ok: true,
		status: 200
	} as Response;
}

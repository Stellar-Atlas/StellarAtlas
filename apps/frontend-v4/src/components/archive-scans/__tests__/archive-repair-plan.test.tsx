/// <reference types="jest" />

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicHistoryArchiveRepairPlan } from '../../../api/archive-repair-types';
import { NodeArchiveRepairPlan } from '../../nodes/node-archive-repair-plan';

describe('archive repair plan', () => {
	it('keeps endpoint candidates separate from proof-gated downloads', () => {
		const markup = renderToStaticMarkup(
			createElement(NodeArchiveRepairPlan, { repairPlan: createPlan() })
		);

		expect(markup).toContain('Confirmed repair evidence');
		expect(markup).toContain('Proof-bound source found; download pending');
		expect(markup).toContain('checkpoint 63 / proof 41 v7 / multi-source');
		expect(markup).toContain('Failed file');
		expect(markup).toContain('Finding');
		expect(markup).toContain('Confirmed archive repair evidence');
		expect(markup).toContain('data-label="Verified replacement"');
		expect(markup).not.toContain('Replace archive file');
		expect(markup).not.toContain(
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
			`11111111-1111-4111-8111-111111111111/${source.proof.candidateObjectRemoteId}/` +
			`${source.proof.proofId}/${source.proof.proofVersion}/` +
			`${Date.parse(source.proof.evaluatedAt)}/${source.proof.contentHash.digest}`;
		const markup = renderToStaticMarkup(
			createElement(NodeArchiveRepairPlan, {
				repairPlan: {
					...plan,
					actions: [
						{
							...action,
							repairArtifact: {
								artifactType: 'transactions',
								byteLength: null,
								contentHash: source.proof.contentHash,
								downloadUrl,
								mediaType: 'application/gzip',
								objectIdentity: 'transactions:0000003f',
								provenAt: source.proof.evaluatedAt,
								status: 'verify-on-download'
							},
							severity: 'error'
						}
					]
				}
			})
		);

		expect(markup).toContain('Verify and download replacement');
		expect(markup).toContain(`href="${downloadUrl}"`);
		expect(markup).toContain('returns bytes only after their');
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

		expect(markup).toContain('Download verified replacement');
		expect(markup).toContain(
			`href="/v1/archive-scans/repair-artifacts/buckets/${'a'.repeat(64)}"`
		);
	});
});

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
				actionId: 'replace-archive-file:object-1',
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
						nextAttemptAt: null,
						objectKey: 'transactions:0000003f',
						objectType: 'transactions',
						objectUrl: 'https://failed.example/transactions/file.xdr.gz',
						observedCheckpointLedger: null,
						remoteId: 'object-1',
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
							proofVersion: 7
						},
						verifiedAt: '2026-07-11T00:00:00.000Z'
					}
				],
				reason: 'missing-object',
				repairArtifact: null,
				severity: 'blocked',
				summary: 'Replace the transaction archive file for checkpoint 63.'
			}
		],
		archiveUrl: 'https://failed.example',
		archiveUrlIdentity: 'https://failed.example',
		generatedAt: '2026-07-11T00:00:00.000Z',
		infrastructureBlocks: [],
		limit: 100,
		summary: {
			activeObjectChecks: 0,
			failedCheckpointProofs: 0,
			failedObjectChecks: 1,
			pendingObjectChecks: 0,
			verifiedObjectChecks: 0
		}
	};
}

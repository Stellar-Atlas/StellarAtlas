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
		expect(markup).toContain('1 candidate source records');
		expect(markup).toContain('verified replacement evidence table below');
		expect(markup).not.toContain('href=');
	});
});

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
						failureClass: 'not-found',
						httpStatus: 404,
						nextAttemptAt: null,
						objectKey: 'transactions:0000003f',
						objectType: 'transactions',
						objectUrl: 'https://failed.example/transactions/file.xdr.gz',
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
						verifiedAt: '2026-07-11T00:00:00.000Z'
					}
				],
				reason: 'missing-object',
				severity: 'error',
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

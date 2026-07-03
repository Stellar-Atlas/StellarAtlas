import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { GetFbasAnalysisProof } from '@fbas/use-cases/get-fbas-analysis-proof/GetFbasAnalysisProof.js';
import { GetFbasAnalysis } from '@fbas/use-cases/get-fbas-analysis/GetFbasAnalysis.js';
import { GetLatestFbasProofSets } from '@fbas/use-cases/get-latest-fbas-proof-sets/GetLatestFbasProofSets.js';
import { GetLatestFbas } from '@fbas/use-cases/get-latest-fbas/GetLatestFbas.js';
import { GetTopTierHistory } from '@fbas/use-cases/get-top-tier-history/GetTopTierHistory.js';
import type {
	FbasBlockingSetsDTO,
	FbasSplittingSetsDTO
} from '@fbas/domain/FbasLatestProofSetDTO.js';
import { FbasRouterWrapper } from '../FbasRouter.js';

describe('FbasProofSetRouter.integration', () => {
	let app: express.Application;
	let getLatestFbasProofSets: jest.Mocked<GetLatestFbasProofSets>;

	beforeEach(() => {
		getLatestFbasProofSets = mock<GetLatestFbasProofSets>();
		app = express();
		app.use(
			'/fbas',
			FbasRouterWrapper({
				getFbasAnalysis: mock<GetFbasAnalysis>(),
				getFbasAnalysisProof: mock<GetFbasAnalysisProof>(),
				getLatestFbasProofSets,
				getLatestFbas: mock<GetLatestFbas>(),
				getTopTierHistory: mock<GetTopTierHistory>()
			})
		);
	});

	it('should expose latest persisted blocking-set evidence', async () => {
		getLatestFbasProofSets.execute.mockResolvedValue(
			ok(makeBlockingSetsResponse())
		);

		await request(app)
			.get('/fbas/blocking-sets/latest')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.setType).toBe('blocking_sets');
				expect(response.body.proofSetPersistence).toBe('persisted');
				expect(response.body.node.blockingSets.sets).toEqual([
					['node-blocking']
				]);
				expect(response.body.node.blockingSetsFiltered.sets).toEqual([
					['node-blocking-filtered']
				]);
			});
		expect(getLatestFbasProofSets.execute).toHaveBeenCalledWith({
			kind: 'blocking_sets'
		});
	});

	it('should expose latest persisted splitting-set evidence', async () => {
		getLatestFbasProofSets.execute.mockResolvedValue(
			ok(makeSplittingSetsResponse())
		);

		await request(app)
			.get('/fbas/splitting-sets/latest')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.setType).toBe('splitting_sets');
				expect(response.body.node.splittingSets.sets).toEqual([
					['node-splitting']
				]);
			});
		expect(getLatestFbasProofSets.execute).toHaveBeenCalledWith({
			kind: 'splitting_sets'
		});
	});

	it('should return not found when latest blocking sets do not exist', async () => {
		getLatestFbasProofSets.execute.mockResolvedValue(ok(null));

		await request(app)
			.get('/fbas/blocking-sets/latest')
			.expect(404)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'Latest FBAS blocking sets not found'
				});
			});
	});

	it('should return not found when latest splitting sets do not exist', async () => {
		getLatestFbasProofSets.execute.mockResolvedValue(ok(null));

		await request(app)
			.get('/fbas/splitting-sets/latest')
			.expect(404)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'Latest FBAS splitting sets not found'
				});
			});
	});

	it('should map latest proof-set use-case failures to server errors', async () => {
		getLatestFbasProofSets.execute.mockResolvedValue(err(new Error('boom')));

		await request(app)
			.get('/fbas/blocking-sets/latest')
			.expect(500)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});
});

function makeBlockingSetsResponse(): FbasBlockingSetsDTO {
	return {
		...makeBaseResponse(),
		complete: true,
		setType: 'blocking_sets',
		node: makeBlockingSetDimension('node'),
		organization: makeBlockingSetDimension('organization'),
		country: makeBlockingSetDimension('country'),
		isp: makeBlockingSetDimension('isp')
	};
}

function makeSplittingSetsResponse(): FbasSplittingSetsDTO {
	return {
		...makeBaseResponse(),
		complete: true,
		setType: 'splitting_sets',
		node: makeSplittingSetDimension('node'),
		organization: makeSplittingSetDimension('organization'),
		country: makeSplittingSetDimension('country'),
		isp: makeSplittingSetDimension('isp')
	};
}

function makeBaseResponse() {
	return {
		generatedAt: '2026-07-03T12:00:00.000Z',
		evidenceSelection: 'latest_network_scan_fbas_proof' as const,
		proofSetPersistence: 'persisted' as const,
		scanId: 42,
		scanTime: '2026-07-03T11:56:00.000Z',
		schemaVersion: 1,
		payloadBytes: 1234,
		limits: {
			proofSetMembers: 32,
			proofSetsPerFamily: 32,
			symmetricTopTierDepth: 4,
			symmetricTopTierInnerSets: 16,
			topTierMembers: 512
		},
		complete: true
	};
}

function makeBlockingSetDimension(label: string) {
	return {
		blockingSets: makeProofSetFamily(`${label}-blocking`),
		blockingSetsFiltered: makeProofSetFamily(`${label}-blocking-filtered`)
	};
}

function makeSplittingSetDimension(label: string) {
	return {
		splittingSets: makeProofSetFamily(`${label}-splitting`)
	};
}

function makeProofSetFamily(label: string) {
	return {
		captureLimit: 32,
		capturedCount: 1,
		complete: true,
		memberLimit: 32,
		minSize: 1,
		sets: [[label]],
		totalCount: 1
	};
}

import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { GetCrossCheckSources } from '@cross-check/use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import { CrossCheckRouterWrapper } from '../CrossCheckRouter.js';

describe('CrossCheckRouter.integration', () => {
	let app: express.Application;
	let getCrossCheckSources: jest.Mocked<GetCrossCheckSources>;

	beforeEach(() => {
		getCrossCheckSources = mock<GetCrossCheckSources>();
		app = express();
		app.use(
			'/cross-check',
			CrossCheckRouterWrapper({
				getCrossCheckSources
			})
		);
	});

	it('should expose configured cross-check sources', async () => {
		getCrossCheckSources.execute.mockReturnValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				probe: 'not_run',
				sources: [
					{
						description: 'Current StellarAtlas API',
						documentationUrl: '/docs',
						id: 'stellaratlas-api',
						kind: 'internal',
						name: 'StellarAtlas Public API',
						probe: 'not_run',
						scopes: ['validators', 'organizations', 'archives'],
						url: '/v1'
					}
				]
			})
		);

		await request(app)
			.get('/cross-check/sources')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=300')
			.expect((response) => {
				expect(response.body.probe).toBe('not_run');
				expect(response.body.sources[0].id).toBe('stellaratlas-api');
			});
	});

	it('should hide internal errors', async () => {
		getCrossCheckSources.execute.mockReturnValue(err(new Error('boom')));

		await request(app)
			.get('/cross-check/sources')
			.expect(500)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});
});

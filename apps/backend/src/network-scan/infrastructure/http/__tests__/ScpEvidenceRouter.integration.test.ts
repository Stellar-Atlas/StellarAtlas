import express from 'express';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import request from 'supertest';
import type { GetScpEvidence } from '../../../use-cases/get-scp-evidence/GetScpEvidence.js';
import { encodeScpEvidenceCursor } from '../../../use-cases/get-scp-evidence/ScpEvidenceCursor.js';
import { scpEvidenceRouter } from '../ScpEvidenceRouter.js';

describe('ScpEvidenceRouter', () => {
	it('passes a validated opaque cursor to detailed evidence reads', async () => {
		const useCase = mock<GetScpEvidence>();
		useCase.getValidator.mockResolvedValue(ok(emptyPage(2)));
		const cursor = { observedAtMs: 1_783_728_000_000, statementHash: 'hash-a' };

		await request(buildApp(useCase))
			.get(
				`/validators/GA?limit=2&cursor=${encodeURIComponent(
					encodeScpEvidenceCursor(cursor)
				)}`
			)
			.expect(200)
			.expect((response) => {
				expect(response.body.page).toEqual({
					hasMore: false,
					limit: 2,
					nextCursor: null
				});
			});

		expect(useCase.getValidator).toHaveBeenCalledWith('GA', 2, cursor);
	});

	it('rejects malformed cursors before calling the use case', async () => {
		const useCase = mock<GetScpEvidence>();

		await request(buildApp(useCase))
			.get('/organizations/org-a?cursor=not-a-cursor')
			.expect(400)
			.expect({ error: 'Invalid evidence cursor' });

		expect(useCase.getOrganization).not.toHaveBeenCalled();
	});
});

function buildApp(useCase: GetScpEvidence) {
	const app = express();
	app.use(scpEvidenceRouter(useCase));
	return app;
}

function emptyPage(limit: number) {
	return {
		metadata: {
			freshness: 'empty' as const,
			freshnessMs: null,
			observedAt: null,
			source: 'postgres_canonical' as const
		},
		page: { hasMore: false, limit, nextCursor: null },
		slots: [],
		statementCount: 0
	};
}

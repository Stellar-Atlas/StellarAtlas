import express from 'express';
import request from 'supertest';
import { validationResult } from 'express-validator';
import {
	archiveEvidencePageValidators,
	parseArchiveEvidencePageOptions
} from '../ArchiveEvidencePageRequest.js';

describe('optional archive copy discovery request', () => {
	const app = express();
	app.get('/', archiveEvidencePageValidators(), (req, res) => {
		if (!validationResult(req).isEmpty()) {
			res.sendStatus(400);
			return;
		}
		res.json(parseArchiveEvidencePageOptions(req));
	});
	it('accepts explicit zero without losing the other failure page parameters', async () => {
		const response = await request(app)
			.get('/?copyLimit=0&failureLimit=10')
			.expect(200);
		expect(response.body).toMatchObject({ copyLimit: 0, failureLimit: 10 });
	});
	it.each(['-1', '11', '0.5'])(
		'rejects invalid copy limit %s',
		async (value) => {
			await request(app).get(`/?copyLimit=${value}`).expect(400);
		}
	);
});

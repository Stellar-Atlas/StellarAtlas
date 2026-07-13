/// <reference types="jest" />

import { parseHistoryArchiveEvidence } from '../history-archive-evidence-parser';
import { buildHistoryArchiveEvidencePath } from '../history-archive-evidence-path';

describe('history archive evidence parser', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('builds and parses the v2 archive-source contract', () => {
		const response = {
			eventPage: {},
			generatedAt: '2026-07-13T00:00:00.000Z',
			objectPage: {},
			remoteFailures: {},
			root: { nodePublicKeys: ['GNODE'] },
			workerIssues: {}
		};
		expect(
			buildHistoryArchiveEvidencePath('https://archive.example/history')
		).toBe(
			'/v2/archive-scans/https%3A%2F%2Farchive.example%2Fhistory/object-evidence'
		);
		expect(parseHistoryArchiveEvidence(response)).toBe(response);
	});

	it('rejects the legacy v1 aggregate response', () => {
		expect(() =>
			parseHistoryArchiveEvidence({
				generatedAt: '2026-07-13T00:00:00.000Z',
				objects: [],
				summary: {}
			})
		).toThrow('did not match the v2 contract');
	});

	it('accepts the required v2 response boundary', () => {
		const response = {
			eventPage: {},
			generatedAt: '2026-07-13T00:00:00.000Z',
			objectPage: {},
			remoteFailures: {},
			root: { nodePublicKeys: ['GNODE'] },
			workerIssues: {}
		};

		expect(parseHistoryArchiveEvidence(response)).toBe(response);
	});
});

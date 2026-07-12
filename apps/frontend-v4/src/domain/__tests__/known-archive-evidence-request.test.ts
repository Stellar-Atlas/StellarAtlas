/// <reference types="jest" />

import {
	failureQuerySignature,
	objectQuerySignature
} from '../known-archive-evidence-request';

describe('known archive evidence query signatures', () => {
	it('is deterministic for an equivalent typed query', () => {
		const subject = { id: 'GNODE', kind: 'node' } as const;

		expect(
			objectQuerySignature(subject, {
				archiveUrl: null,
				objectType: 'bucket',
				status: 'pending'
			})
		).toBe(
			objectQuerySignature(subject, {
				status: 'pending',
				objectType: 'bucket',
				archiveUrl: null
			})
		);
	});

	it('changes with the subject or filter values', () => {
		const query = { archiveUrl: null, objectType: 'bucket' } as const;

		expect(
			failureQuerySignature({ id: 'GNODE-A', kind: 'node' }, query)
		).not.toBe(failureQuerySignature({ id: 'GNODE-B', kind: 'node' }, query));
		expect(
			failureQuerySignature({ id: 'GNODE-A', kind: 'node' }, query)
		).not.toBe(
			failureQuerySignature(
				{ id: 'GNODE-A', kind: 'node' },
				{ archiveUrl: null, objectType: 'ledger' }
			)
		);
	});

	it('keeps an archive root distinct from node and organization subjects', () => {
		const query = { archiveUrl: null, objectType: 'bucket' } as const;
		const archiveUrl = 'https://history.example/archive';

		expect(
			failureQuerySignature({ id: archiveUrl, kind: 'archive' }, query)
		).not.toBe(failureQuerySignature({ id: archiveUrl, kind: 'node' }, query));
	});
});

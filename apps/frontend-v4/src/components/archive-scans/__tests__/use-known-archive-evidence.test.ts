/// <reference types="jest" />

import type { ArchiveEvidenceObjectQuery } from '../../../domain/known-archive-evidence-request';
import {
	getObjectQueryForTab,
	shouldLoadInitialActivityPage
} from '../use-known-archive-evidence';

describe('known archive evidence tab queries', () => {
	it('loads pending work when entering Current work directly from Failures', () => {
		const failureQuery = createQuery('failed');

		expect(getObjectQueryForTab('work', failureQuery)).toEqual({
			...failureQuery,
			status: 'pending'
		});
	});

	it.each(['pending', 'scanning'] as const)(
		'keeps an existing %s Current work query',
		(status) => {
			expect(getObjectQueryForTab('work', createQuery(status))).toBeNull();
		}
	);

	it('loads Activity after its initial projection was omitted', () => {
		expect(shouldLoadInitialActivityPage('activity', 0)).toBe(true);
		expect(shouldLoadInitialActivityPage('activity', 25)).toBe(false);
		expect(shouldLoadInitialActivityPage('failures', 0)).toBe(false);
	});
});

function createQuery(
	status: ArchiveEvidenceObjectQuery['status']
): ArchiveEvidenceObjectQuery {
	return {
		archiveUrl: null,
		objectType: null,
		status
	};
}

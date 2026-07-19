/// <reference types="jest" />

import type { ArchiveEvidenceObjectQuery } from '../../../domain/known-archive-evidence-request';
import {
	getObjectRefreshQuery,
	getObjectQueryForTab,
	shouldLoadInitialActivityPage
} from '../known-archive-evidence-tab-query';

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

	it('opens Current work on checking rows when no waiting rows exist', () => {
		expect(
			getObjectQueryForTab('work', createQuery('failed'), {
				activeObjects: 3,
				pendingObjects: 0
			})
		).toEqual({ ...createQuery('failed'), status: 'scanning' });
	});

	it('moves off an empty work status when only the other status has rows', () => {
		expect(
			getObjectQueryForTab('work', createQuery('scanning'), {
				activeObjects: 0,
				pendingObjects: 4
			})
		).toEqual({ ...createQuery('scanning'), status: 'pending' });
	});

	it('switches a live Current work refresh to the non-empty status', () => {
		expect(
			getObjectRefreshQuery('work', createQuery('pending'), {
				activeObjects: 2,
				pendingObjects: 0
			})
		).toEqual({ ...createQuery('pending'), status: 'scanning' });
	});

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

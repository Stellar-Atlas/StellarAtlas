import {
	searchQueryScopeLabels,
	searchResultScopeLabels
} from '../layout/search-scope-labels';

describe('search scope labels', () => {
	it('uses plural labels for query facets and singular labels for hits', () => {
		expect(searchQueryScopeLabels['current-validator']).toBe(
			'Current validators'
		);
		expect(searchResultScopeLabels['current-validator']).toBe(
			'Current validator'
		);
		expect(searchQueryScopeLabels.listener).toBe('Current listeners');
		expect(searchResultScopeLabels.listener).toBe('Current listener');
		expect(searchQueryScopeLabels['current-organization']).toBe(
			'Current organizations'
		);
		expect(searchResultScopeLabels['current-organization']).toBe(
			'Current organization'
		);
		expect(searchQueryScopeLabels['archive-root']).toBe('Archive roots');
		expect(searchResultScopeLabels['archive-root']).toBe('Archive root');
	});
});

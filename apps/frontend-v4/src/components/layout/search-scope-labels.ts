import type {
	PublicSearchDocumentScope,
	PublicSearchQueryScope
} from '../../api/search-types';

export const searchQueryScopeLabels: Record<PublicSearchQueryScope, string> = {
	'all-known': 'All known',
	'archive-root': 'Archive roots',
	archived: 'Archived / inactive',
	'current-organization': 'Current organizations',
	'current-validator': 'Current validators',
	listener: 'Current listeners',
	'public-key-only': 'Public-key only'
};

export const searchResultScopeLabels: Record<
	PublicSearchDocumentScope,
	string
> = {
	'archive-root': 'Archive root',
	archived: 'Archived / inactive',
	'current-organization': 'Current organization',
	'current-validator': 'Current validator',
	listener: 'Current listener',
	'public-key-only': 'Public-key only'
};

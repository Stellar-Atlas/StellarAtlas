export function swaggerReferenceUrl(theme: 'dark' | 'light', hash = ''): string {
	return '/api-docs?view=swagger&embedded=1&theme=' + theme +
		(hash.startsWith('#') ? hash : '');
}

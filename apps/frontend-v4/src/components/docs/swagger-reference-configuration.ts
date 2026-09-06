export function swaggerReferenceUrl(
	theme: 'dark' | 'light',
	hash = ''
): string {
	return '/docs/reference?theme=' + theme + (hash.startsWith('#') ? hash : '');
}

const rootStatePath = '/.well-known/stellar-history.json';
const categoryObjectPathPattern =
	/\/(history|ledger|transactions|results|scp)\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\/\1-[0-9a-f]{8}\.(json|xdr\.gz)$/i;
const bucketObjectPathPattern =
	/\/bucket\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\/bucket-[0-9a-f]+\.xdr\.gz$/i;

export function normalizeHistoryArchiveRootUrl(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed === '') return null;

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (url.username !== '' || url.password !== '') return null;
	if (url.hash !== '') return null;

	const path = normalizePath(url.pathname);
	const rootPath = stripRootStatePath(path);
	if (isArchiveObjectPath(rootPath)) return null;

	return `${url.origin}${rootPath === '/' ? '' : rootPath}${url.search}`;
}

export function appendHistoryArchiveRootPath(
	rootValue: string,
	relativePath: string
): string | null {
	const normalizedRoot = normalizeHistoryArchiveRootUrl(rootValue);
	if (normalizedRoot === null || relativePath.trim() === '') return null;

	const root = new URL(normalizedRoot);
	const basePath = root.pathname.replace(/\/+$/, '');
	const suffix = relativePath.replace(/^\/+/, '');
	root.pathname = `${basePath}/${suffix}`;
	root.hash = '';
	return root.toString();
}

function normalizePath(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	return trimmed === '' ? '/' : trimmed;
}

function stripRootStatePath(path: string): string {
	if (path === rootStatePath) return '/';
	if (!path.endsWith(rootStatePath)) return path;

	const stripped = path.slice(0, -rootStatePath.length);
	return stripped === '' ? '/' : stripped;
}

function isArchiveObjectPath(path: string): boolean {
	return (
		categoryObjectPathPattern.test(path) || bucketObjectPathPattern.test(path)
	);
}

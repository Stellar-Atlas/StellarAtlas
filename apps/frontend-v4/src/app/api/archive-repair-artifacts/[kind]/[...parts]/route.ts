import { isValidArchiveRepairArtifactPath } from '@api/archive-repair-download-path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const requestTimeoutMs = 5 * 60_000;
const forwardedHeaders = [
	'content-disposition',
	'content-length',
	'content-type',
	'etag',
	'last-modified',
	'x-stellar-bucket-hash',
	'x-stellar-content-representation',
	'x-stellar-proof-content-sha256'
] as const;

export async function GET(
	_request: Request,
	context: { readonly params: Promise<{ kind: string; parts: string[] }> }
): Promise<Response> {
	const { kind, parts } = await context.params;
	const segments = [kind, ...parts];
	if (!isValidArchiveRepairArtifactPath(segments)) {
		return Response.json({ error: 'invalid-repair-artifact' }, { status: 400 });
	}
	const username = process.env.HISTORY_SCAN_API_USERNAME;
	const password = process.env.HISTORY_SCAN_API_PASSWORD;
	if (!username || !password) {
		return Response.json(
			{ error: 'repair-service-unavailable' },
			{ status: 503 }
		);
	}
	const apiBaseUrl = (
		process.env.STELLAR_ATLAS_PUBLIC_API_URL ?? 'http://127.0.0.1:3000'
	).replace(/\/+$/, '');
	let upstream: Response;
	try {
		upstream = await fetch(
			apiBaseUrl +
				'/v1/archive-scans/repair-artifacts/' +
				segments.map(encodeURIComponent).join('/'),
			{
				cache: 'no-store',
				headers: {
					Accept: 'application/gzip, application/json',
					Authorization:
						'Basic ' + Buffer.from(username + ':' + password).toString('base64')
				},
				signal: AbortSignal.timeout(requestTimeoutMs)
			}
		);
	} catch {
		return Response.json(
			{ error: 'repair-service-unavailable' },
			{ status: 503 }
		);
	}
	if (upstream.status === 401 || upstream.status === 403) {
		return Response.json(
			{ error: 'repair-service-authorization-failed' },
			{ status: 502 }
		);
	}
	const headers = new Headers({ 'cache-control': 'private, no-store' });
	for (const name of forwardedHeaders) {
		const value = upstream.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	return new Response(upstream.body, {
		headers,
		status: upstream.status,
		statusText: upstream.statusText
	});
}

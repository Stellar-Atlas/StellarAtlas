const deadlineMs = 65_000;
export const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

const routes = {
	transaction: ['/v1/analytics/transactions/', ''],
	'account balance': ['/v1/analytics/accounts/', '/balances']
} as const;

export async function proxyExplorerJson(
	request: Request,
	resource: keyof typeof routes,
	identifier: string,
	query: URLSearchParams,
	maxResponseBytes: number
): Promise<Response> {
	const deadline = AbortSignal.timeout(deadlineMs);
	const signal = AbortSignal.any([request.signal, deadline]);
	try {
		const target = new URL(process.env.STELLAR_ATLAS_PUBLIC_API_URL?.trim() || 'http://127.0.0.1:3000');
		if ((target.protocol !== 'http:' && target.protocol !== 'https:') ||
			target.username || target.password || target.search || target.hash)
			throw new Error('Invalid explorer API base URL');
		if (!identifier || /[^A-Za-z0-9]/.test(identifier))
			throw new Error('Invalid explorer path segment');
		// Request data cannot set the authority or select a raw upstream path.
		// Encode each component separately; encoding a full URL is not safe.
		const [prefix, suffix] = routes[resource];
		target.pathname = target.pathname.replace(/\/+$/, '') + prefix + encodeURIComponent(identifier) + suffix;
		target.search = [...query].map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
		const upstream = await fetch(target.href, {
			headers: { accept: 'application/json' },
			cache: 'no-store',
			redirect: 'error',
			signal
		});
		const media = upstream.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
		const length = upstream.headers.get('content-length');
		const error = upstream.ok && upstream.status !== 200
			? `The ${resource} service returned an unexpected success status.`
			: media !== 'application/json' || !upstream.body
			? `The ${resource} service did not return a JSON response.`
			: length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes)
				? `The ${resource} response exceeds the explorer size limit.`
				: null;
		if (error || !upstream.body) {
			void upstream.body?.cancel().catch(() => undefined);
			const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
			return Response.json({ error }, { status, headers: noStore });
		}
		const headers = new Headers({ ...noStore, 'content-type': 'application/json; charset=utf-8' });
		const retryAfter = upstream.headers.get('retry-after');
		if (retryAfter !== null) headers.set('retry-after', retryAfter);
		let bytes = 0;
		const body = upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, stream) {
				bytes += chunk.byteLength;
				if (bytes > maxResponseBytes)
					throw new Error(`The ${resource} response exceeds the explorer size limit.`);
				stream.enqueue(chunk);
			}
		}), { signal });
		return new Response(body, { status: upstream.status, headers });
	} catch {
		const timedOut = deadline.aborted && !request.signal.aborted;
		return Response.json({
			error: timedOut
				? `The explorer did not receive ${resource === 'transaction' ? 'a transaction' : 'an account balance'} response within 65 seconds.`
				: `The explorer could not reach the ${resource} service.`
		}, { status: timedOut ? 504 : 502, headers: noStore });
	}
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const deadlineMs = 65_000;
// At most 20 operations, 20 effects and 20 events, including decoded and raw
// representations. Leave room for dense records without buffering the page.
const maxResponseBytes = 16 * 1024 * 1024;
const cursorKeys = ['operations_after', 'effects_after', 'events_after'];
const allowed = new Set(['view', 'limit', 'ledger_sequence', ...cursorKeys]);
const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/** Only the explorer's typed GET bypasses Next's default 30s rewrite proxy. */
export async function GET(
	request: Request,
	{ params }: { readonly params: Promise<{ hash: string }> }
): Promise<Response> {
	if (request.method !== 'GET')
		return new Response(null, { status: 405, headers: { ...noStore, allow: 'GET' } });
	const { hash } = await params;
	const query = new URL(request.url).searchParams;
	const ledger = query.get('ledger_sequence');
	if (!/^[a-f0-9]{64}$/i.test(hash) ||
		query.get('view') !== 'typed' || query.get('limit') !== '20' ||
		[...query.keys()].some(key => !allowed.has(key) || query.getAll(key).length !== 1) ||
		(ledger !== null && (!/^[1-9][0-9]{0,9}$/.test(ledger) || Number(ledger) > 2_147_483_647)) ||
		cursorKeys.some(key => query.has(key) && !/^[A-Za-z0-9_-]{1,2048}$/.test(query.get(key) ?? ''))) {
		return Response.json({ error: 'Invalid typed transaction query.' }, { status: 400, headers: noStore });
	}

	const base = (process.env.STELLAR_ATLAS_PUBLIC_API_URL?.trim() || 'http://127.0.0.1:3000').replace(/\/+$/, '');
	const deadline = AbortSignal.timeout(deadlineMs);
	const signal = AbortSignal.any([request.signal, deadline]);
	try {
		const upstream = await fetch(base + '/v1/analytics/transactions/' + hash + '?' + query, {
			headers: { accept: 'application/json' },
			cache: 'no-store',
			redirect: 'error',
			signal
		});
		const media = upstream.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
		const length = upstream.headers.get('content-length');
		const error = upstream.ok && upstream.status !== 200
			? 'The transaction service returned an unexpected success status.'
			: media !== 'application/json' || !upstream.body
			? 'The transaction service did not return a JSON response.'
			: length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes)
				? 'The transaction response exceeds the explorer size limit.'
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
					throw new Error('The transaction response exceeds the explorer size limit.');
				stream.enqueue(chunk);
			}
		}), { signal });
		return new Response(body, { status: upstream.status, headers });
	} catch {
		const timedOut = deadline.aborted && !request.signal.aborted;
		return Response.json({
			error: timedOut
				? 'The explorer did not receive a transaction response within 65 seconds.'
				: 'The explorer could not reach the transaction service.'
		}, { status: timedOut ? 504 : 502, headers: noStore });
	}
}

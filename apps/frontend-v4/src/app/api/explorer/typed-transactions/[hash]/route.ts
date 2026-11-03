export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const deadlineMs = 65_000;
const cursorKeys = ['operations_after', 'effects_after', 'events_after'];
const allowed = new Set(['view', 'limit', 'ledger_sequence', ...cursorKeys]);
const noStore = { 'cache-control': 'no-store' };

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
	try {
		const upstream = await fetch(base + '/v1/analytics/transactions/' + hash + '?' + query, {
			headers: { accept: 'application/json' },
			cache: 'no-store',
			redirect: 'error',
			signal: AbortSignal.any([request.signal, deadline])
		});
		const headers = new Headers(noStore);
		for (const name of ['content-type', 'retry-after']) {
			const value = upstream.headers.get(name);
			if (value !== null) headers.set(name, value);
		}
		return new Response(upstream.body, { status: upstream.status, headers });
	} catch {
		const timedOut = deadline.aborted && !request.signal.aborted;
		return Response.json({
			error: timedOut
				? 'The explorer did not receive a transaction response within 65 seconds.'
				: 'The explorer could not reach the transaction service.'
		}, { status: timedOut ? 504 : 502, headers: noStore });
	}
}

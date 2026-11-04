import { noStore, proxyExplorerJson } from '../../bounded-json-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// At most 20 operations, 20 effects and 20 events, including decoded and raw
// representations. Leave room for dense records without buffering the page.
const maxResponseBytes = 16 * 1024 * 1024;
const cursorKeys = ['operations_after', 'effects_after', 'events_after'];
const allowed = new Set(['view', 'limit', 'ledger_sequence', ...cursorKeys]);

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

	return proxyExplorerJson(request, 'transaction', hash, query, maxResponseBytes);
}

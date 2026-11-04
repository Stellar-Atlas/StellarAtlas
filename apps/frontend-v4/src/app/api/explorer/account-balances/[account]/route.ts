import { isClassicAccount } from '../../../../../domain/classic-account';
import { noStore, proxyExplorerJson } from '../../bounded-json-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Allow the published coverage metadata as well as 25 fixed-shape balance rows.
const maxResponseBytes = 4 * 1024 * 1024;

export async function GET(
	request: Request,
	{ params }: { readonly params: Promise<{ account: string }> }
): Promise<Response> {
	if (request.method !== 'GET')
		return new Response(null, { status: 405, headers: { ...noStore, allow: 'GET' } });
	const { account } = await params;
	const query = new URL(request.url).searchParams;
	const after = query.get('after');
	if (!isClassicAccount(account) || query.get('limit') !== '25' ||
		[...query.keys()].some(key => (key !== 'limit' && key !== 'after') || query.getAll(key).length !== 1) ||
		(after !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(after))) {
		return Response.json({ error: 'Invalid account balance query.' }, { status: 400, headers: noStore });
	}
	return proxyExplorerJson(request, 'account balance', account, query, maxResponseBytes);
}

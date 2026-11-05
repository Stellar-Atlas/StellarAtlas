import { isClassicAccount } from '../../../../../domain/classic-account';
import { noStore, proxyExplorerJson } from '../../bounded-json-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
	request: Request,
	{ params }: { readonly params: Promise<{ account: string }> }
): Promise<Response> {
	const { account } = await params;
	const query = new URL(request.url).searchParams;
	if (request.method !== 'GET')
		return new Response(null, { status: 405, headers: { ...noStore, allow: 'GET' } });
	if (!isClassicAccount(account) || query.size !== 0)
		return Response.json({ error: 'Invalid current account request.' }, { status: 400, headers: noStore });
	return proxyExplorerJson(request, 'current account', account, query, 2 * 1024 * 1024);
}

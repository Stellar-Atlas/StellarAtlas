import { isClassicAccount } from '../../../../../domain/classic-account';
import { protocolPositionBytes } from '../../../../../domain/account-protocol-position';
import { noStore, proxyExplorerJson } from '../../bounded-json-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { readonly params: Promise<{ account: string }> }): Promise<Response> {
	if (process.env.STELLAR_ATLAS_ACCOUNT_PROTOCOL_POSITIONS !== '1')
		return Response.json({ error: 'Not found' }, { status: 404, headers: noStore });
	if (request.method !== 'GET')
		return new Response(null, { status: 405, headers: { ...noStore, allow: 'GET' } });
	const { account } = await params;
	const url = new URL(request.url);
	if (!isClassicAccount(account) || url.searchParams.size !== 0)
		return Response.json({ error: 'Invalid protocol position request.' }, { status: 400, headers: noStore });
	return proxyExplorerJson(request, 'account protocol positions', account, url.searchParams, protocolPositionBytes);
}

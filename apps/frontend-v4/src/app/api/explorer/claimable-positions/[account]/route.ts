import { isClassicAccount } from '../../../../../domain/classic-account';
import { isClaimableCursor, isClaimableRole, claimablePageBytes } from '../../../../../domain/claimable-positions';
import { noStore, proxyExplorerJson } from '../../bounded-json-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { readonly params: Promise<{ account: string }> }): Promise<Response> {
	if (process.env.STELLAR_ATLAS_ACCOUNT_CLAIMABLE_POSITIONS !== '1')
		return Response.json({ error: 'Not found' }, { status: 404, headers: noStore });
	if (request.method !== 'GET')
		return new Response(null, { status: 405, headers: { ...noStore, allow: 'GET' } });
	const { account } = await params;
	const query = new URL(request.url).searchParams;
	const role = query.get('role'), cursor = query.get('cursor');
	if (!isClassicAccount(account) || !isClaimableRole(role) ||
		query.size !== (cursor === null ? 1 : 2) || (cursor !== null && !isClaimableCursor(cursor)))
		return Response.json({ error: 'Invalid claimable positions request.' }, { status: 400, headers: noStore });
	return proxyExplorerJson(request, 'account claimable positions', account, query, claimablePageBytes);
}

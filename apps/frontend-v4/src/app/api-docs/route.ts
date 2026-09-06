import { renderSwaggerReference } from './render-reference';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
	return renderSwaggerReference(
		request,
		new URL(request.url).searchParams.get('embedded') === '1'
	);
}

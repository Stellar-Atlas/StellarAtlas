import { renderSwaggerReference } from '../../api-docs/render-reference';

export const dynamic = 'force-dynamic';

// Path-bound mode: public /api-docs routing cannot discard the embed option.
export async function GET(request: Request): Promise<Response> {
	return renderSwaggerReference(request, true);
}

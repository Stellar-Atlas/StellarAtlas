import { fetchArchiveInventorySnapshot } from '@api/archive-inventory-server';

export async function GET(): Promise<Response> {
	try {
		return Response.json(await fetchArchiveInventorySnapshot(), {
			headers: {
				'Cache-Control':
					'public, max-age=0, s-maxage=15, stale-while-revalidate=60, stale-if-error=3600'
			}
		});
	} catch (error) {
		console.error('Archive inventory refresh failed', error);
		return Response.json(
			{ error: 'Archive inventory temporarily unavailable' },
			{
				status: 503,
				headers: { 'Cache-Control': 'no-store' }
			}
		);
	}
}

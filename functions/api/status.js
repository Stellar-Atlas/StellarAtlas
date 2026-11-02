import { readStatus } from '../../lib/store.mjs';

export async function onRequestGet({ env }) {
  try {
    const data = await readStatus(env.DB, Date.now());
    return Response.json(data, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=15',
      'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return Response.json({ unavailable: true }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

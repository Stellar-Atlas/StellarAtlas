import { authorized, runCheck } from '../../../lib/monitor.mjs';

export async function onRequestPost({ request, env }) {
  if (!await authorized(request, env.MONITOR_TOKEN)) return new Response(null, { status: 404 });
  try {
    return Response.json(await runCheck(env), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ checked: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

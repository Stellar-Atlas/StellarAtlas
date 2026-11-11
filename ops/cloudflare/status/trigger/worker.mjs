const ENDPOINT = 'https://stellaratlas-status.pages.dev/api/internal/check';

// Pages owns the monitoring logic and outage records. This schedule-only Worker
// has no public route and only wakes the authenticated Pages function.
export async function runScheduledCheck(env, fetchImpl = fetch) {
  if (!/^[a-f0-9]{64}$/.test(env.STATUS_MONITOR_TOKEN ?? '')) {
    throw new Error('Status monitor authorization is not configured');
  }
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST', redirect: 'manual',
    headers: { authorization: `Bearer ${env.STATUS_MONITOR_TOKEN}` },
    signal: AbortSignal.timeout(45_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Scheduled status check was unsuccessful');
}

export default {
  fetch() { return new Response('Not found', { status: 404 }); },
  scheduled(_event, env, context) {
    context.waitUntil(runScheduledCheck(env));
  },
};

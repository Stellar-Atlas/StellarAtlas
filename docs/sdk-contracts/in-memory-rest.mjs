import { registerHubbleSemanticRoutes } from '../../apps/backend/src/status/infrastructure/http/HubbleSemanticRoutes.js';

// Invoke the registered handlers directly. No listener, socket or server is opened.
export async function rest(warehouse, url) {
  const routes = new Map();
  // The typed transaction handler is registered before the legacy fallback.
  registerHubbleSemanticRoutes({ get(path, handler) { if (!routes.has(path)) routes.set(path, handler); } }, warehouse);
  const parsed = new URL(url, 'https://fixture.invalid');
  const relative = parsed.pathname.replace(/^\/v1(?:\/analytics)?/, '');
  let params, handler;
  for (const [route, candidate] of routes) {
    const names = [...route.matchAll(/:([A-Za-z]+)/g)].map(m => m[1]);
    const match = relative.match(new RegExp('^' + route.replace(/:[A-Za-z]+/g, '([^/]+)') + '$'));
    if (match) { params = Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(match[i + 1])])); handler = candidate; break; }
  }
  if (!handler) throw new Error('Unregistered design fixture route');
  const query = {};
  for (const key of new Set(parsed.searchParams.keys())) {
    const values = parsed.searchParams.getAll(key);
    query[key] = values.length === 1 ? values[0] : values;
  }
  let status = 200, body;
  const response = { setHeader() {}, status(code) { status = code; return response; },
    json(value) { body = JSON.parse(JSON.stringify(value)); return response; } };
  await handler({ params, query }, response, () => { throw new Error('Legacy representation excluded'); });
  return { status, body };
}

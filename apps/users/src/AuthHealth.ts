import type { Router } from 'express';

// Register after the service's Basic Auth middleware. This checks authentication
// only; it deliberately has no database or mail-provider dependencies.
export function registerAuthHealthRoute(api: Pick<Router, 'get'>): void {
	api.get('/health/auth', (_request, response) => {
		response.set('Cache-Control', 'no-store').status(204).end();
	});
}

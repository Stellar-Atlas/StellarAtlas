import express, { type Request, type Response, type Router } from 'express';
import basicAuth from 'express-basic-auth';
import { registerAuthHealthRoute } from '../AuthHealth.js';

type Result = {
	status: number;
	body: unknown;
	headers: Record<string, string>;
};

// Exercise real Express routing and Basic Auth without opening a socket or
// importing the service entry point, database, credentials, or mail transport.
function dispatch(
	router: Router,
	authorization?: string,
	method = 'GET',
	url = '/health/auth'
): Promise<Result> {
	return new Promise((resolve, reject) => {
		const request = {
			method,
			url,
			headers: authorization ? { authorization } : {}
		};
		let status = 200;
		const headers: Record<string, string> = {};
		const response = {
			status(code: number) {
				status = code;
				return response;
			},
			set(name: string, value: string) {
				headers[name.toLowerCase()] = value;
				return response;
			},
			end(body?: unknown) {
				resolve({ status, body, headers });
				return response;
			},
			send(body: unknown) {
				return response.end(body);
			}
		};
		router(request as Request, response as unknown as Response, (error: unknown) => {
			if (error) reject(error);
			else resolve({ status: 404, body: undefined, headers });
		});
	});
}

const credentials = (name: string, secret: string) =>
	`Basic ${Buffer.from(`${name}:${secret}`).toString('base64')}`;
const valid = credentials('fixture-consumer', 'fixture-secret');

function fixture() {
	const router = express.Router();
	router.use(basicAuth({ users: { 'fixture-consumer': 'fixture-secret' } }));
	registerAuthHealthRoute(router);
	return router;
}

it.each([
	['missing', undefined],
	['malformed', 'Basic !!!'],
	['unsupported scheme', 'Bearer fixture-token'],
	['wrong user', credentials('unknown', 'fixture-secret')],
	['wrong secret', credentials('fixture-consumer', 'incorrect')]
])('rejects %s authentication', async (_name, authorization) => {
	const result = await dispatch(fixture(), authorization);
	expect(result.status).toBe(401);
});

it('accepts existing consumer authentication with an empty non-cacheable response', async () => {
	await expect(dispatch(fixture(), valid)).resolves.toEqual({
		status: 204,
		body: undefined,
		headers: { 'cache-control': 'no-store' }
	});
});

it('keeps implicit HEAD requests authenticated and bodyless', async () => {
	expect((await dispatch(fixture(), undefined, 'HEAD')).status).toBe(401);
	expect(await dispatch(fixture(), valid, 'HEAD')).toEqual({
		status: 204,
		body: undefined,
		headers: { 'cache-control': 'no-store' }
	});
});

it('does not add a write method or claim health for an unrelated path', async () => {
	expect((await dispatch(fixture(), valid, 'POST')).status).toBe(404);
	expect((await dispatch(fixture(), valid, 'GET', '/health/provider')).status).toBe(404);
});

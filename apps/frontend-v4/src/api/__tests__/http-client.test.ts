/// <reference types="jest" />

import { fetchJson, fetchNullableJson } from '../http-client';

describe('HTTP client response deadline', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it.each([
		['JSON', fetchJson<unknown>],
		['nullable JSON', fetchNullableJson<unknown>]
	])(
		'keeps the timeout active while parsing %s response bodies',
		async (_, read) => {
			globalThis.fetch = async (_input, init) =>
				stalledJsonResponse(init?.signal);

			await expect(read('/v1/status', { timeoutMs: 10 })).rejects.toMatchObject(
				{
					name: 'AbortError'
				}
			);
		}
	);
});

function stalledJsonResponse(signal: AbortSignal | null | undefined): Response {
	return {
		json: () =>
			new Promise((_resolve, reject) => {
				signal?.addEventListener('abort', () => {
					reject(new DOMException('The operation was aborted', 'AbortError'));
				});
			}),
		ok: true,
		status: 200
	} as Response;
}

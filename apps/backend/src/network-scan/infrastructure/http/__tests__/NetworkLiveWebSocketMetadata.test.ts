import { createServer, type Server } from 'http';
import { ok } from 'neverthrow';
import { WebSocket } from 'ws';
import type { GetLatestObservedLedger } from '../../../use-cases/get-latest-observed-ledger/GetLatestObservedLedger.js';
import type { GetNetwork } from '../../../use-cases/get-network/GetNetwork.js';
import type { GetScpStatements } from '../../../use-cases/get-scp-statements/GetScpStatements.js';
import { attachNetworkLiveWebSocket } from '../NetworkLiveWebSocket.js';

describe('NetworkLiveWebSocket metadata', () => {
	it('sends initial and changed source metadata without statement deltas', async () => {
		const server = createServer();
		const getScpStatements = {
			executeWithMetadata: jest
				.fn()
				.mockResolvedValueOnce(
					ok({
						freshness: 'empty',
						freshnessMs: null,
						observations: [],
						observedAt: null,
						source: 'meilisearch'
					})
				)
				.mockResolvedValue(
					ok({
						freshness: 'unavailable',
						freshnessMs: null,
						observations: [],
						observedAt: null,
						source: 'postgres_canonical'
					})
				)
		} as unknown as GetScpStatements;

		attachNetworkLiveWebSocket(server, {
			getLatestObservedLedger: createLatestLedgerReader(),
			getNetwork: {
				execute: jest.fn().mockResolvedValue(ok({ latestLedger: '1' }))
			} as unknown as GetNetwork,
			getScpStatements,
			horizonUrl: 'http://127.0.0.1:1',
			path: '/ws'
		});
		await listen(server);

		const socket = new WebSocket(`ws://127.0.0.1:${addressPort(server)}/ws`);
		try {
			const messages = await waitForScpMessages(socket, 2);

			expect(messages).toEqual([
				expect.objectContaining({
					freshness: 'empty',
					payload: [],
					source: 'meilisearch'
				}),
				expect.objectContaining({
					freshness: 'unavailable',
					payload: [],
					source: 'postgres_canonical'
				})
			]);
		} finally {
			socket.close();
			await close(server);
		}
	});
});

function createLatestLedgerReader(): GetLatestObservedLedger {
	return {
		execute: jest.fn().mockResolvedValue(
			ok({
				closedAt: '2026-07-05T00:00:01.000Z',
				freshness: 'fresh',
				freshnessMs: 1_000,
				observedAt: '2026-07-05T00:00:02.000Z',
				protocolVersion: null,
				sequence: '63326550',
				source: 'scp_live_collector'
			})
		)
	} as unknown as GetLatestObservedLedger;
}

function waitForScpMessages(
	socket: WebSocket,
	count: number
): Promise<Array<{ freshness: string; payload: unknown[]; source: string }>> {
	return new Promise((resolve, reject) => {
		const messages: Array<{
			freshness: string;
			payload: unknown[];
			source: string;
		}> = [];
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for ${count} SCP messages`));
		}, 3_000);
		const onMessage = (data: { toString(): string }): void => {
			const message = JSON.parse(data.toString()) as {
				freshness?: unknown;
				payload?: unknown;
				source?: unknown;
				type?: unknown;
			};
			if (message.type !== 'scp' || !Array.isArray(message.payload)) return;
			messages.push({
				freshness: String(message.freshness),
				payload: message.payload,
				source: String(message.source)
			});
			if (messages.length < count) return;
			cleanup();
			resolve(messages);
		};
		const onError = (error: Error): void => {
			cleanup();
			reject(error);
		};
		const cleanup = (): void => {
			clearTimeout(timeout);
			socket.off('message', onMessage);
			socket.off('error', onError);
		};
		socket.on('message', onMessage);
		socket.on('error', onError);
	});
}

function listen(server: Server): Promise<void> {
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => resolve());
	});
}

function close(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

function addressPort(server: Server): number {
	const address = server.address();
	if (address === null || typeof address === 'string') {
		throw new Error('Server did not bind to a TCP port');
	}
	return address.port;
}

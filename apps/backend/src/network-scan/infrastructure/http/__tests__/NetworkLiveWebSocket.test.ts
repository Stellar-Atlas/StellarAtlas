import { createServer, type Server } from 'http';
import { WebSocket } from 'ws';
import { ok } from 'neverthrow';
import type { ScpStatementObservationV1 } from 'shared';
import type { GetNetwork } from '../../../use-cases/get-network/GetNetwork.js';
import type { GetScpStatements } from '../../../use-cases/get-scp-statements/GetScpStatements.js';
import type { GetLatestObservedLedger } from '../../../use-cases/get-latest-observed-ledger/GetLatestObservedLedger.js';
import { attachNetworkLiveWebSocket } from '../NetworkLiveWebSocket.js';

describe('NetworkLiveWebSocket', () => {
	it('sends scanner-owned latest ledger before falling back to Horizon', async () => {
		const server = createServer();
		const getNetwork = {
			execute: jest.fn().mockResolvedValue(ok({ latestLedger: '1' }))
		} as unknown as GetNetwork;
		const getScpStatements = {
			executeWithMetadata: jest.fn().mockResolvedValue(ok(readResult([])))
		} as unknown as GetScpStatements;

		attachNetworkLiveWebSocket(server, {
			getLatestObservedLedger: createLatestObservedLedgerReader(),
			getNetwork,
			getScpStatements,
			horizonUrl: 'http://127.0.0.1:1',
			path: '/ws'
		});
		await listen(server);

		const socket = new WebSocket(`ws://127.0.0.1:${addressPort(server)}/ws`);
		try {
			const message = await waitForLatestLedgerMessage(socket);

			expect(message.payload).toEqual({
				closedAt: '2026-07-05T00:00:01.000Z',
				freshness: 'fresh',
				freshnessMs: 1_000,
				observedAt: '2026-07-05T00:00:02.000Z',
				protocolVersion: null,
				sequence: '63326550',
				source: 'scp_live_collector'
			});
		} finally {
			socket.close();
			await close(server);
		}
	});

	it('labels Horizon fallback after stale scanner-owned ledger rejection', async () => {
		const closedAt = new Date().toISOString();
		const server = createServer((_request, response) => {
			response.setHeader('Content-Type', 'application/json');
			response.end(
				JSON.stringify({
					_embedded: {
						records: [
							{
								closed_at: closedAt,
								id: 'ledger-id',
								protocol_version: 23,
								sequence: 63326551
							}
						]
					}
				})
			);
		});
		await listen(server);
		const getScpStatements = {
			executeWithMetadata: jest.fn().mockResolvedValue(ok(readResult([])))
		} as unknown as GetScpStatements;
		attachNetworkLiveWebSocket(server, {
			getLatestObservedLedger: {
				execute: jest.fn().mockResolvedValue(ok(null))
			} as unknown as GetLatestObservedLedger,
			getNetwork: {
				execute: jest.fn().mockResolvedValue(ok({ latestLedger: '1' }))
			} as unknown as GetNetwork,
			getScpStatements,
			horizonUrl: `http://127.0.0.1:${addressPort(server)}`,
			path: '/ws'
		});

		const socket = new WebSocket(`ws://127.0.0.1:${addressPort(server)}/ws`);
		try {
			const message = await waitForLatestLedgerMessage(socket);

			expect(message.payload).toMatchObject({
				closedAt,
				freshness: 'fresh',
				protocolVersion: 23,
				sequence: '63326551',
				source: 'horizon_fallback'
			});
			expect(message.payload.freshnessMs).toEqual(expect.any(Number));
			expect(message.payload.observedAt).toEqual(expect.any(String));
		} finally {
			socket.close();
			await close(server);
		}
	});

	it('sends canonical fallback SCP deltas with source and freshness labels', async () => {
		const server = createServer();
		const getNetwork = {
			execute: jest.fn().mockResolvedValue(ok({ latestLedger: '1' }))
		} as unknown as GetNetwork;
		const getScpStatements = {
			executeWithMetadata: jest
				.fn()
				.mockResolvedValueOnce(
					ok(
						readResult([
							createStatement('statement-b'),
							createStatement('statement-a')
						])
					)
				)
				.mockResolvedValue(ok(readResult([])))
		} as unknown as GetScpStatements;

		attachNetworkLiveWebSocket(server, {
			getLatestObservedLedger: createLatestObservedLedgerReader(),
			getNetwork,
			getScpStatements,
			horizonUrl: 'http://127.0.0.1:1',
			path: '/ws'
		});
		await listen(server);

		const socket = new WebSocket(`ws://127.0.0.1:${addressPort(server)}/ws`);
		try {
			const message = await waitForScpMessage(socket);

			expect(getScpStatements.executeWithMetadata).toHaveBeenCalledWith({
				after: undefined,
				limit: 1000,
				order: 'desc',
				source: 'auto'
			});
			expect(message).toMatchObject({
				freshness: 'fresh',
				freshnessMs: 1_000,
				observedAt: '2026-07-05T00:00:00.000Z',
				source: 'postgres_canonical'
			});
			expect(
				message.payload.map((statement) => statement.statementHash)
			).toEqual(['statement-a', 'statement-b']);
			await waitForScpReadCount(getScpStatements, 2);
			expect(getScpStatements.executeWithMetadata).toHaveBeenLastCalledWith({
				after: {
					observedAtMs: new Date('2026-07-05T00:00:00.000Z').getTime(),
					statementHash: 'statement-b'
				},
				limit: 1000,
				order: 'asc',
				source: 'auto'
			});
		} finally {
			socket.close();
			await close(server);
		}
	});

	it('does not resend older unique statements after a client cursor advances', async () => {
		const server = createServer();
		const getNetwork = {
			execute: jest.fn().mockResolvedValue(ok({ latestLedger: '1' }))
		} as unknown as GetNetwork;
		const getScpStatements = {
			executeWithMetadata: jest
				.fn()
				.mockResolvedValueOnce(
					ok(
						readResult([
							createStatement('statement-current', '2026-07-05T00:00:01.000Z')
						])
					)
				)
				.mockResolvedValueOnce(
					ok(
						readResult([
							createStatement('statement-older', '2026-07-05T00:00:00.000Z')
						])
					)
				)
				.mockResolvedValue(ok(readResult([])))
		} as unknown as GetScpStatements;

		attachNetworkLiveWebSocket(server, {
			getLatestObservedLedger: createLatestObservedLedgerReader(),
			getNetwork,
			getScpStatements,
			horizonUrl: 'http://127.0.0.1:1',
			path: '/ws'
		});
		await listen(server);

		const socket = new WebSocket(`ws://127.0.0.1:${addressPort(server)}/ws`);
		try {
			const message = await waitForScpMessage(socket);
			expect(
				message.payload.map((statement) => statement.statementHash)
			).toEqual(['statement-current']);
			await waitForScpReadCount(getScpStatements, 2);
			await expectNoScpMessage(socket);
		} finally {
			socket.close();
			await close(server);
		}
	});
});

function createLatestObservedLedgerReader(): GetLatestObservedLedger {
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

function readResult(
	observations: ScpStatementObservationV1[],
	overrides: Partial<{
		freshness: 'empty' | 'fresh' | 'stale' | 'unavailable';
		freshnessMs: number | null;
		observedAt: string | null;
		source: 'meilisearch' | 'postgres_canonical';
	}> = {}
) {
	return {
		freshness:
			observations.length === 0 ? ('empty' as const) : ('fresh' as const),
		freshnessMs: observations.length === 0 ? null : 1_000,
		observations,
		observedAt: observations.length === 0 ? null : '2026-07-05T00:00:00.000Z',
		source: 'postgres_canonical' as const,
		...overrides
	};
}

function createStatement(
	statementHash: string,
	observedAt = '2026-07-05T00:00:00.000Z'
): ScpStatementObservationV1 {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt,
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: { accepted: [], quorumSetHash: '', votes: [] },
		signature: '',
		slotIndex: '63326550',
		statementHash,
		statementType: 'nominate',
		statementXdr: '',
		values: []
	};
}

function waitForLatestLedgerMessage(socket: WebSocket): Promise<{
	payload: {
		closedAt: string;
		freshness?: string;
		freshnessMs?: number;
		observedAt?: string;
		protocolVersion: number | null;
		sequence: string;
		source?: string;
	};
	type: 'latestLedger';
}> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(
				new Error('Timed out waiting for latest ledger websocket message')
			);
		}, 2_000);

		socket.on('message', (data) => {
			const message = JSON.parse(data.toString()) as {
				freshness?: unknown;
				freshnessMs?: unknown;
				observedAt?: unknown;
				payload?: unknown;
				source?: unknown;
				type?: unknown;
			};
			if (message.type === 'error') {
				clearTimeout(timeout);
				reject(
					new Error(`WebSocket error: ${JSON.stringify(message.payload)}`)
				);
				return;
			}
			if (message.type !== 'latestLedger') return;
			clearTimeout(timeout);
			resolve({
				payload: message.payload as {
					closedAt: string;
					protocolVersion: number | null;
					sequence: string;
					source?: string;
				},
				type: 'latestLedger'
			});
		});
		socket.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		socket.on('close', (code, reason) => {
			clearTimeout(timeout);
			reject(new Error(`WebSocket closed ${code}: ${reason.toString()}`));
		});
	});
}

function expectNoScpMessage(socket: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		const onMessage = (data: { toString(): string }): void => {
			const message = JSON.parse(data.toString()) as {
				payload?: unknown;
				type?: unknown;
			};
			if (message.type !== 'scp') return;
			cleanup();
			reject(new Error('Unexpected SCP websocket message'));
		};
		const timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, 500);
		const cleanup = (): void => {
			clearTimeout(timeout);
			socket.off('message', onMessage);
		};
		socket.on('message', onMessage);
	});
}

function listen(server: Server): Promise<void> {
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => resolve());
	});
}

function waitForScpReadCount(
	getScpStatements: GetScpStatements,
	expectedCalls: number
): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			clearInterval(interval);
			reject(new Error('Timed out waiting for SCP websocket reads'));
		}, 2_500);
		const interval = setInterval(() => {
			if (
				jest.mocked(getScpStatements.executeWithMetadata).mock.calls.length <
				expectedCalls
			)
				return;
			clearTimeout(timeout);
			clearInterval(interval);
			resolve();
		}, 25);
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

function waitForScpMessage(socket: WebSocket): Promise<{
	freshness: string;
	freshnessMs: number | null;
	observedAt: string | null;
	payload: ScpStatementObservationV1[];
	source: string;
	type: 'scp';
}> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error('Timed out waiting for SCP websocket message'));
		}, 2_000);

		socket.on('message', (data) => {
			const message = JSON.parse(data.toString()) as {
				freshness?: unknown;
				freshnessMs?: unknown;
				observedAt?: unknown;
				payload?: unknown;
				source?: unknown;
				type?: unknown;
			};
			if (message.type === 'error') {
				clearTimeout(timeout);
				reject(
					new Error(`WebSocket error: ${JSON.stringify(message.payload)}`)
				);
				return;
			}
			if (message.type !== 'scp' || !Array.isArray(message.payload)) {
				return;
			}
			clearTimeout(timeout);
			resolve({
				freshness: String(message.freshness),
				freshnessMs:
					typeof message.freshnessMs === 'number' ? message.freshnessMs : null,
				observedAt:
					typeof message.observedAt === 'string' ? message.observedAt : null,
				payload: message.payload as ScpStatementObservationV1[],
				source: String(message.source),
				type: 'scp'
			});
		});
		socket.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		socket.on('close', (code, reason) => {
			clearTimeout(timeout);
			reject(new Error(`WebSocket closed ${code}: ${reason.toString()}`));
		});
	});
}

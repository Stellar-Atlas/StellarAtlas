import { createServer, type Server } from 'http';
import { WebSocket } from 'ws';
import { ok } from 'neverthrow';
import type { ScpStatementObservationV1 } from 'shared';
import type { GetNetwork } from '../../../use-cases/get-network/GetNetwork.js';
import type { GetScpStatements } from '../../../use-cases/get-scp-statements/GetScpStatements.js';
import { attachNetworkLiveWebSocket } from '../NetworkLiveWebSocket.js';

describe('NetworkLiveWebSocket', () => {
	it('sends live-only SCP deltas in cursor order', async () => {
		const server = createServer();
		const getNetwork = {
			execute: jest.fn().mockResolvedValue(ok({ latestLedger: '1' }))
		} as unknown as GetNetwork;
		const getScpStatements = {
			execute: jest
				.fn()
				.mockResolvedValueOnce(
					ok([createStatement('statement-b'), createStatement('statement-a')])
				)
				.mockResolvedValue(ok([]))
		} as unknown as GetScpStatements;

		attachNetworkLiveWebSocket(server, {
			getNetwork,
			getScpStatements,
			horizonUrl: 'http://127.0.0.1:1',
			path: '/ws'
		});
		await listen(server);

		const socket = new WebSocket(`ws://127.0.0.1:${addressPort(server)}/ws`);
		try {
			const message = await waitForScpMessage(socket);

			expect(getScpStatements.execute).toHaveBeenCalledWith({
				after: undefined,
				limit: 1000,
				order: 'desc',
				source: 'live'
			});
			expect(
				message.payload.map((statement) => statement.statementHash)
			).toEqual(['statement-a', 'statement-b']);
			await waitForScpReadCount(getScpStatements, 2);
			expect(getScpStatements.execute).toHaveBeenLastCalledWith({
				after: {
					observedAtMs: new Date('2026-07-05T00:00:00.000Z').getTime(),
					statementHash: 'statement-b'
				},
				limit: 1000,
				order: 'asc',
				source: 'live'
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
			execute: jest
				.fn()
				.mockResolvedValueOnce(
					ok([createStatement('statement-current', '2026-07-05T00:00:01.000Z')])
				)
				.mockResolvedValueOnce(
					ok([createStatement('statement-older', '2026-07-05T00:00:00.000Z')])
				)
				.mockResolvedValue(ok([]))
		} as unknown as GetScpStatements;

		attachNetworkLiveWebSocket(server, {
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
				jest.mocked(getScpStatements.execute).mock.calls.length < expectedCalls
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
	payload: ScpStatementObservationV1[];
	type: 'scp';
}> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error('Timed out waiting for SCP websocket message'));
		}, 2_000);

		socket.on('message', (data) => {
			const message = JSON.parse(data.toString()) as {
				payload?: unknown;
				type?: unknown;
			};
			if (message.type !== 'scp' || !Array.isArray(message.payload)) {
				return;
			}
			clearTimeout(timeout);
			resolve({
				payload: message.payload as ScpStatementObservationV1[],
				type: 'scp'
			});
		});
		socket.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
	});
}

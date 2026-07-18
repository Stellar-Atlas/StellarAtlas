import { createServer, type Server } from 'http';
import { ok } from 'neverthrow';
import type { ScpStatementObservationV1 } from 'shared';
import { WebSocket } from 'ws';
import type { GetLatestObservedLedger } from '../../../use-cases/get-latest-observed-ledger/GetLatestObservedLedger.js';
import type { GetNetwork } from '../../../use-cases/get-network/GetNetwork.js';
import type { GetScpStatements } from '../../../use-cases/get-scp-statements/GetScpStatements.js';
import {
	attachNetworkLiveWebSocket,
	parseNetworkLiveResumeCursor
} from '../NetworkLiveWebSocket.js';
import { scpStatementTransportCeilingBytes } from '../ScpStatementTransportPolicy.js';

describe('NetworkLiveWebSocket resume cursor', () => {
	it('requires one valid timestamp and statement hash', () => {
		expect(parseNetworkLiveResumeCursor('/ws')).toEqual({
			cursor: null,
			valid: true
		});
		expect(
			parseNetworkLiveResumeCursor(
				'/ws?afterObservedAtMs=1783209600000&afterStatementHash=hash-a'
			)
		).toEqual({
			cursor: { observedAtMs: 1_783_209_600_000, statementHash: 'hash-a' },
			valid: true
		});
		for (const requestUrl of [
			'/ws?afterObservedAtMs=1',
			'/ws?afterStatementHash=hash-a',
			'/ws?afterObservedAtMs=unsafe&afterStatementHash=hash-a',
			'/ws?afterObservedAtMs=-1&afterStatementHash=hash-a',
			'/ws?afterObservedAtMs=1&afterStatementHash=%20',
			'/ws?afterObservedAtMs=1&afterObservedAtMs=2&afterStatementHash=hash-a'
		]) {
			expect(parseNetworkLiveResumeCursor(requestUrl)).toEqual({
				valid: false
			});
		}
	});

	it('losslessly drains 2,000 missed rows across bounded frames and clears truncation', async () => {
		const baseObservedAtMs = Date.parse('2026-07-05T00:00:00.000Z');
		const resumeCursor = {
			observedAtMs: baseObservedAtMs,
			statementHash: 'statement-before-disconnect'
		};
		const missed = Array.from({ length: 2_000 }, (_, index) =>
			createStatement(index, baseObservedAtMs + index + 1)
		);
		const executeWithMetadata = jest.fn(
			async (
				request: Parameters<GetScpStatements['executeWithMetadata']>[0]
			) => {
				const after = request.after;
				const page = missed
					.filter((statement) =>
						after === undefined
							? true
							: compareStatementToCursor(statement, after) > 0
					)
					.slice(0, request.limit ?? 1_000);
				return ok(readResult(page));
			}
		);
		const getScpStatements = {
			executeWithMetadata
		} as unknown as GetScpStatements;
		const server = createServer();
		attachNetworkLiveWebSocket(server, liveConfig(getScpStatements));
		await listen(server);
		const query = new URLSearchParams({
			afterObservedAtMs: resumeCursor.observedAtMs.toString(),
			afterStatementHash: resumeCursor.statementHash
		});
		const socket = new WebSocket(
			`ws://127.0.0.1:${addressPort(server)}/ws?${query.toString()}`
		);

		try {
			const frames = await collectUntilTruncationClears(socket, missed.length);
			const delivered = frames.flatMap((frame) => frame.payload);
			expect(delivered.map(({ statementHash }) => statementHash)).toEqual(
				missed.map(({ statementHash }) => statementHash)
			);
			expect(
				new Set(delivered.map(({ statementHash }) => statementHash)).size
			).toBe(missed.length);
			expect(executeWithMetadata.mock.calls).toHaveLength(3);
			expect(executeWithMetadata.mock.calls[0]?.[0]).toMatchObject({
				after: resumeCursor,
				limit: 1_000,
				order: 'asc',
				source: 'auto'
			});
			expect(executeWithMetadata.mock.calls[1]?.[0].after).toEqual(
				cursorFor(missed[999]!)
			);
			expect(executeWithMetadata.mock.calls[2]?.[0].after).toEqual(
				cursorFor(missed[1_999]!)
			);
			expect(frames.some(({ truncated }) => truncated)).toBe(true);
			expect(frames.at(-1)).toMatchObject({
				cursor: cursorFor(missed[1_999]!),
				payload: [],
				truncated: false
			});
			for (const frame of frames) {
				expect(frame.serializedBytes).toBeLessThanOrEqual(
					scpStatementTransportCeilingBytes
				);
			}
		} finally {
			await closeSocket(socket);
			await close(server);
		}
	});
});

interface CapturedScpFrame {
	readonly cursor: { observedAtMs: number; statementHash: string } | null;
	readonly payload: ScpStatementObservationV1[];
	readonly serializedBytes: number;
	readonly truncated: boolean;
}

function collectUntilTruncationClears(
	socket: WebSocket,
	expectedStatements: number
): Promise<CapturedScpFrame[]> {
	return new Promise((resolve, reject) => {
		const frames: CapturedScpFrame[] = [];
		let statementCount = 0;
		const timeout = setTimeout(
			() => reject(new Error('Timed out waiting for SCP reconnect catch-up')),
			10_000
		);
		socket.on('message', (data) => {
			const serialized = data.toString();
			const message = JSON.parse(serialized) as {
				cursor?: CapturedScpFrame['cursor'];
				payload?: unknown;
				truncated?: unknown;
				type?: unknown;
			};
			if (message.type === 'error') {
				clearTimeout(timeout);
				reject(new Error(`Live stream error: ${serialized}`));
				return;
			}
			if (message.type !== 'scp' || !Array.isArray(message.payload)) return;
			const frame: CapturedScpFrame = {
				cursor: message.cursor ?? null,
				payload: message.payload as ScpStatementObservationV1[],
				serializedBytes: Buffer.byteLength(serialized, 'utf8'),
				truncated: message.truncated === true
			};
			frames.push(frame);
			statementCount += frame.payload.length;
			if (statementCount < expectedStatements || frame.truncated) return;
			clearTimeout(timeout);
			resolve(frames);
		});
		socket.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
	});
}

function liveConfig(getScpStatements: GetScpStatements) {
	return {
		getLatestObservedLedger: {
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
		} as unknown as GetLatestObservedLedger,
		getNetwork: {
			execute: jest.fn().mockResolvedValue(ok({ latestLedger: '63326550' }))
		} as unknown as GetNetwork,
		getScpStatements,
		horizonUrl: 'http://127.0.0.1:1',
		path: '/ws'
	};
}

function readResult(observations: ScpStatementObservationV1[]) {
	return {
		freshness: 'fresh' as const,
		freshnessMs: 1_000,
		observations,
		observedAt: '2026-07-05T00:00:02.000Z',
		source: 'postgres_canonical' as const
	};
}

function createStatement(
	sequence: number,
	observedAtMs: number
): ScpStatementObservationV1 {
	const statementHash = `statement-${sequence.toString().padStart(4, '0')}`;
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date(observedAtMs).toISOString(),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: { accepted: [], quorumSetHash: '', votes: [] },
		signature: '',
		slotIndex: '63326550',
		statementHash,
		statementType: 'nominate',
		statementXdr: 'x'.repeat(256),
		values: []
	};
}

function compareStatementToCursor(
	statement: ScpStatementObservationV1,
	cursor: { observedAtMs: number; statementHash: string }
): number {
	return (
		Date.parse(statement.observedAt) - cursor.observedAtMs ||
		statement.statementHash.localeCompare(cursor.statementHash)
	);
}

function cursorFor(statement: ScpStatementObservationV1) {
	return {
		observedAtMs: Date.parse(statement.observedAt),
		statementHash: statement.statementHash
	};
}

function listen(server: Server): Promise<void> {
	return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function addressPort(server: Server): number {
	const address = server.address();
	if (address === null || typeof address === 'string') {
		throw new Error('Server did not bind to a TCP port');
	}
	return address.port;
}

function closeSocket(socket: WebSocket): Promise<void> {
	if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
	return new Promise((resolve) => {
		socket.once('close', () => resolve());
		socket.close();
	});
}

function close(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

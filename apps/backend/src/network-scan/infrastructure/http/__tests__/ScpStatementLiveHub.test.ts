import { ok } from 'neverthrow';
import type { ScpStatementObservationV1 } from 'shared';
import type { GetScpStatements } from '../../../use-cases/get-scp-statements/GetScpStatements.js';
import {
	getSharedScpStatementLiveHub,
	ScpStatementLiveHub,
	type ScpStatementLiveUpdate
} from '../ScpStatementLiveHub.js';

describe('ScpStatementLiveHub', () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	it('fans one backend read out to many SSE and WebSocket subscribers', async () => {
		const reader = createReader(readResult([createStatement('statement-a')]));
		const sseHub = getSharedScpStatementLiveHub(reader);
		const webSocketHub = getSharedScpStatementLiveHub(reader);
		const updates = Array.from({ length: 64 }, () => jest.fn());
		const unsubscribes = updates.map((onUpdate, index) =>
			(index % 2 === 0 ? sseHub : webSocketHub).subscribe({
				onError: jest.fn(),
				onUpdate
			})
		);

		await flushPromises();

		expect(reader.executeWithMetadata).toHaveBeenCalledTimes(1);
		for (const onUpdate of updates) {
			expect(onUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					metadataChanged: true,
					statements: [
						expect.objectContaining({ statementHash: 'statement-a' })
					]
				})
			);
		}
		for (const unsubscribe of unsubscribes) unsubscribe?.();
	});

	it('emits initial and changed metadata without statement deltas', async () => {
		jest.useFakeTimers();
		const reader = createReader(
			readResult([], {
				freshness: 'empty',
				freshnessMs: null,
				observedAt: null,
				source: 'postgres_canonical'
			})
		);
		reader.executeWithMetadata.mockResolvedValueOnce(
			ok(
				readResult([], {
					freshness: 'empty',
					freshnessMs: null,
					observedAt: null,
					source: 'postgres_canonical'
				})
			)
		);
		reader.executeWithMetadata.mockResolvedValueOnce(
			ok(
				readResult([], {
					freshness: 'unavailable',
					freshnessMs: null,
					observedAt: null,
					source: 'postgres_canonical'
				})
			)
		);
		const onUpdate = jest.fn<void, [ScpStatementLiveUpdate]>();
		const hub = new ScpStatementLiveHub(reader, undefined, { intervalMs: 100 });
		const unsubscribe = hub.subscribe({ onError: jest.fn(), onUpdate });

		await flushPromises();
		expect(onUpdate).toHaveBeenCalledTimes(1);
		expect(onUpdate.mock.calls[0]?.[0].statements).toEqual([]);
		jest.advanceTimersByTime(100);
		await flushPromises();

		expect(onUpdate).toHaveBeenCalledTimes(2);
		expect(onUpdate.mock.calls[1]?.[0]).toMatchObject({
			metadata: { freshness: 'unavailable' },
			metadataChanged: true,
			statements: []
		});
		unsubscribe?.();
	});

	it('enforces one aggregate 256-subscriber cap', async () => {
		const reader = createReader(readResult([]));
		const hub = new ScpStatementLiveHub(reader);
		const unsubscribes = Array.from({ length: 256 }, () =>
			hub.subscribe({ onError: jest.fn(), onUpdate: jest.fn() })
		);

		expect(unsubscribes.every((unsubscribe) => unsubscribe !== null)).toBe(
			true
		);
		expect(
			hub.subscribe({ onError: jest.fn(), onUpdate: jest.fn() })
		).toBeNull();
		await flushPromises();
		expect(reader.executeWithMetadata).toHaveBeenCalledTimes(1);
		for (const unsubscribe of unsubscribes) unsubscribe?.();
	});

	it('stops polling after the final disconnect', async () => {
		jest.useFakeTimers();
		const reader = createReader(readResult([]));
		const hub = new ScpStatementLiveHub(reader, undefined, { intervalMs: 100 });
		const unsubscribe = hub.subscribe({
			onError: jest.fn(),
			onUpdate: jest.fn()
		});
		await flushPromises();
		unsubscribe?.();

		jest.advanceTimersByTime(1_000);
		await flushPromises();

		expect(reader.executeWithMetadata).toHaveBeenCalledTimes(1);
	});

	it('removes subscribers that reject delivery', async () => {
		jest.useFakeTimers();
		const reader = createReader(readResult([]));
		const hub = new ScpStatementLiveHub(reader, undefined, { intervalMs: 100 });
		hub.subscribe({ onError: jest.fn(), onUpdate: () => false });
		await flushPromises();
		jest.advanceTimersByTime(1_000);
		await flushPromises();

		expect(reader.executeWithMetadata).toHaveBeenCalledTimes(1);
	});

	it('shares one hub for the same reader instance', () => {
		const reader = createReader(readResult([]));

		expect(getSharedScpStatementLiveHub(reader)).toBe(
			getSharedScpStatementLiveHub(reader)
		);
	});

	it('splits dense updates into cursor-safe deltas below the byte limit', async () => {
		const statements = ['statement-a', 'statement-b', 'statement-c'].map(
			createStatement
		);
		const maxDeltaBytes =
			Buffer.byteLength(JSON.stringify([statements[0]]), 'utf8') + 1;
		const reader = createReader(readResult(statements));
		const onUpdate = jest.fn<void, [ScpStatementLiveUpdate]>();
		const hub = new ScpStatementLiveHub(reader, undefined, { maxDeltaBytes });
		const unsubscribe = hub.subscribe({ onError: jest.fn(), onUpdate });

		await flushPromises();

		expect(onUpdate).toHaveBeenCalledTimes(3);
		const delivered = onUpdate.mock.calls.flatMap(
			([update]) => update.statements
		);
		expect(delivered.map(({ statementHash }) => statementHash)).toEqual([
			'statement-a',
			'statement-b',
			'statement-c'
		]);
		for (const [update] of onUpdate.mock.calls) {
			expect(
				Buffer.byteLength(JSON.stringify(update.statements), 'utf8')
			).toBeLessThanOrEqual(maxDeltaBytes);
		}
		unsubscribe?.();
	});
});

function createReader(result: ReturnType<typeof readResult>) {
	return {
		executeWithMetadata: jest.fn().mockResolvedValue(ok(result))
	} as unknown as jest.Mocked<Pick<GetScpStatements, 'executeWithMetadata'>>;
}

function readResult(
	observations: ScpStatementObservationV1[],
	metadata: {
		freshness: 'empty' | 'fresh' | 'stale' | 'unavailable';
		freshnessMs: number | null;
		observedAt: string | null;
		source: 'meilisearch' | 'postgres_canonical';
	} = {
		freshness: observations.length === 0 ? 'empty' : 'fresh',
		freshnessMs: observations.length === 0 ? null : 1_000,
		observedAt: observations.length === 0 ? null : '2026-07-05T00:00:00.000Z',
		source: 'postgres_canonical'
	}
) {
	return { ...metadata, observations };
}

function createStatement(statementHash: string): ScpStatementObservationV1 {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: '2026-07-05T00:00:00.000Z',
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

async function flushPromises(): Promise<void> {
	for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

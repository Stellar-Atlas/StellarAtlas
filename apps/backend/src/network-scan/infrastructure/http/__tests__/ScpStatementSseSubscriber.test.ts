import { ok } from 'neverthrow';
import type { ScpStatementObservationV1 } from 'shared';
import type { GetScpStatements } from '../../../use-cases/get-scp-statements/GetScpStatements.js';
import { ScpStatementLiveHub } from '../ScpStatementLiveHub.js';
import {
	createScpStatementSseSubscriber,
	type ScpStatementSseResponse
} from '../ScpStatementSseSubscriber.js';

describe('ScpStatementSseSubscriber', () => {
	it('fans one bounded hub read out to many SSE clients with metadata', async () => {
		const reader = {
			executeWithMetadata: jest.fn().mockResolvedValue(
				ok({
					freshness: 'fresh',
					freshnessMs: 500,
					observations: [createStatement()],
					observedAt: '2026-07-05T00:00:00.000Z',
					source: 'postgres_canonical'
				})
			)
		} as unknown as Pick<GetScpStatements, 'executeWithMetadata'>;
		const hub = new ScpStatementLiveHub(reader);
		const responses = Array.from({ length: 48 }, () => new FakeResponse());
		const unsubscribes = responses.map((response) =>
			hub.subscribe(createScpStatementSseSubscriber(response))
		);

		await flushPromises();

		expect(reader.executeWithMetadata).toHaveBeenCalledTimes(1);
		for (const response of responses) {
			expect(response.output).toContain('event: scp-metadata');
			expect(response.output).toContain('"source":"postgres_canonical"');
			expect(response.output).toContain('event: scp');
		}
		for (const unsubscribe of unsubscribes) unsubscribe?.();
	});

	it('ends a client that exceeds the response write buffer', () => {
		const response = new FakeResponse(false);
		const subscriber = createScpStatementSseSubscriber(response);

		expect(
			subscriber.onUpdate({
				metadata: {
					freshness: 'empty',
					freshnessMs: null,
					observedAt: null,
					source: 'postgres_canonical'
				},
				metadataChanged: true,
				statements: []
			})
		).toBe(false);
		expect(response.writableEnded).toBe(true);
	});
});

class FakeResponse implements ScpStatementSseResponse {
	output = '';
	writableEnded = false;

	constructor(private readonly acceptsWrites = true) {}

	end(): void {
		this.writableEnded = true;
	}

	write(chunk: string): boolean {
		this.output += chunk;
		return this.acceptsWrites;
	}
}

function createStatement(): ScpStatementObservationV1 {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: '2026-07-05T00:00:00.000Z',
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: { accepted: [], quorumSetHash: '', votes: [] },
		signature: '',
		slotIndex: '63326550',
		statementHash: 'statement-a',
		statementType: 'nominate',
		statementXdr: '',
		values: []
	};
}

async function flushPromises(): Promise<void> {
	for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

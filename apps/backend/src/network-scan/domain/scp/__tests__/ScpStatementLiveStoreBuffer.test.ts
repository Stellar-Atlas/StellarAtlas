import { mock } from 'jest-mock-extended';
import type { Logger } from '@core/services/Logger.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementLiveStore } from '../ScpStatementLiveStore.js';
import { ScpStatementLiveStoreBuffer } from '../ScpStatementLiveStoreBuffer.js';

describe('ScpStatementLiveStoreBuffer', () => {
	it('should stop waiting for an active live-store flush after abort', async () => {
		const liveStore = mock<ScpStatementLiveStore>();
		const logger = mock<Logger>();
		let finishSave: (() => void) | undefined;
		let markSaveStarted: () => void = () => {};
		const saveStarted = new Promise<void>((resolve) => {
			markSaveStarted = resolve;
		});
		liveStore.saveMany.mockImplementation(async () => {
			markSaveStarted();
			await new Promise<void>((resolve) => {
				finishSave = resolve;
			});
		});
		const buffer = new ScpStatementLiveStoreBuffer(liveStore, logger, {
			batchSize: 10,
			flushDelayMs: 10_000
		});

		buffer.add(createObservation());
		const flush = buffer.flush();
		await saveStarted;
		buffer.abort();

		await expect(flush).resolves.toBeUndefined();
		finishSave?.();
	});
});

function createObservation(): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date('2026-07-03T00:00:11.250Z'),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: {} as CrawlerScpStatementObservation['pledges'],
		signature: 'signature',
		slotIndex: '11',
		statementHash: 'statement-hash',
		statementType: 'externalize',
		statementXdr: 'statement-xdr',
		values: []
	};
}

import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import { selectLatestObservedScpLedger } from '../ScpLatestObservedLedger.js';

describe('selectLatestObservedScpLedger', () => {
	it('advances only from externalized values with factual close times', () => {
		const externalized = createObservation('100', 'externalize', '1783684800');
		const proposed = createObservation('101', 'nominate', '1783684805');

		expect(
			selectLatestObservedScpLedger(
				[externalized, proposed],
				'scp_live_collector'
			)
		).toEqual({
			closedAt: new Date('2026-07-10T12:00:00.000Z'),
			observedAt: externalized.observedAt,
			sequence: '100',
			source: 'scp_live_collector'
		});
	});
});

function createObservation(
	slotIndex: string,
	statementType: CrawlerScpStatementObservation['statementType'],
	closeTime: string
): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date('2026-07-10T12:00:01.000Z'),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: {} as CrawlerScpStatementObservation['pledges'],
		signature: 'signature',
		slotIndex,
		statementHash: `statement-${slotIndex}`,
		statementType,
		statementXdr: 'xdr',
		values: [
			{ closeTime, txSetHash: 'tx-set', upgradeCount: 0, value: 'value' }
		]
	};
}

import { tradePerspectiveTuples } from '../HubbleAssetReportQuery.js';

describe('asset ranking trade perspectives', () => {
	it('maps seller and taker sides to the exact asset and buy/sell direction', () => {
		const [sellerSellsA, takerBuysA, sellerBuysB, takerSellsB] =
			tradePerspectiveTuples();
		expect(sellerSellsA).toContain('tupleElement(t,1)');
		expect(sellerSellsA).toContain(
			"'sell',tupleElement(t,9),tupleElement(t,10)"
		);
		expect(takerBuysA).toContain('tupleElement(t,2)');
		expect(takerBuysA).toContain("'buy',tupleElement(t,9),tupleElement(t,10)");
		expect(sellerBuysB).toContain('tupleElement(t,1)');
		expect(sellerBuysB).toContain("'buy',tupleElement(t,10),tupleElement(t,9)");
		expect(takerSellsB).toContain('tupleElement(t,2)');
		expect(takerSellsB).toContain(
			"'sell',tupleElement(t,10),tupleElement(t,9)"
		);
	});
});

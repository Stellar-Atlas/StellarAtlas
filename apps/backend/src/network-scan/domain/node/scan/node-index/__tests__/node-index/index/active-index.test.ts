import { ActiveIndex } from '@network-scan/domain/node/scan/node-index/index/active-index.js';

test('get', () => {
	expect(ActiveIndex.get(100)).toEqual(1);
	expect(ActiveIndex.get(50)).toEqual(0.5);
});

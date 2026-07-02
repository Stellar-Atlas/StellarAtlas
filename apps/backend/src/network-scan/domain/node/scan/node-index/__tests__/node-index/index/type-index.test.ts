import { TypeIndex } from '@network-scan/domain/node/scan/node-index/index/type-index.js';

test('get', () => {
	expect(TypeIndex.get(false, false)).toEqual(0.3);
	expect(TypeIndex.get(false, true)).toEqual(0.7);
	expect(TypeIndex.get(true, true)).toEqual(1);
});

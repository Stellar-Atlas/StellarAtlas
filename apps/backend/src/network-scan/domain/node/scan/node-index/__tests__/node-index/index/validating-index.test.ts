import { ValidatingIndex } from '@network-scan/domain/node/scan/node-index/index/validating-index.js';

test('get', () => {
	expect(ValidatingIndex.get(100)).toEqual(1);
	expect(ValidatingIndex.get(50)).toEqual(0.5);
});

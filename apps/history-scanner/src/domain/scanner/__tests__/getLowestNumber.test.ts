import { getLowestNumber } from '../getLowestNumber.js';

it('should get lowest number in large array', function () {
	const numbers = [...Array(10000000).keys()];
	const lowestNumber = getLowestNumber(numbers.reverse());
	expect(lowestNumber).toBe(0);
});

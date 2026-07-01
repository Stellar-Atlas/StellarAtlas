import { StandardCheckPointFrequency } from '../StandardCheckPointFrequency.js';

it('should have a frequency of 64', function () {
	const frequency = new StandardCheckPointFrequency();
	expect(frequency.get()).toEqual(64);
});

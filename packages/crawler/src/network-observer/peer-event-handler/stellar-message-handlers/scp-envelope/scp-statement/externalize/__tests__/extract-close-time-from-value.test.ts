import { extractCloseTimeFromValue } from '../extract-close-time-from-value.js';
import { createDummyExternalizeMessage } from '@fixtures/createDummyExternalizeMessage.js';

describe('extract-close-time-from-value', () => {
	it('should extract close time from value', () => {
		const externalizeMessage = createDummyExternalizeMessage();
		const pledges = externalizeMessage.value.statement.pledges;
		if (pledges.type !== 'scpStExternalize')
			throw new Error('Expected externalize fixture');
		const value = pledges.value.commit.value.toBytes();
		const result = extractCloseTimeFromValue(value);
		expect(result).toEqual(new Date('2024-02-27T08:36:24.000Z'));
	});
});

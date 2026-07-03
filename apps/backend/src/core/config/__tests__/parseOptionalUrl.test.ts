import { parseOptionalUrl } from '../parseOptionalUrl.js';

describe('parseOptionalUrl', () => {
	it('should return undefined for missing or blank values', () => {
		expect(parseOptionalUrl(undefined)._unsafeUnwrap()).toBeUndefined();
		expect(parseOptionalUrl('   ')._unsafeUnwrap()).toBeUndefined();
	});

	it('should parse valid URL values', () => {
		expect(
			parseOptionalUrl(' https://rpc.example.com ')._unsafeUnwrap()
		).toEqual({
			value: 'https://rpc.example.com'
		});
	});

	it('should reject invalid URL values', () => {
		expect(parseOptionalUrl('not-a-url').isErr()).toBe(true);
	});
});

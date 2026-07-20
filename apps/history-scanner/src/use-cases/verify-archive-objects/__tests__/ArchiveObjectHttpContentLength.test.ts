import { readArchiveObjectContentLength } from '../ArchiveObjectHttpContentLength.js';

describe('readArchiveObjectContentLength', () => {
	it('reads a case-insensitive compressed response size', () => {
		expect(readArchiveObjectContentLength({ 'Content-Length': ' 4096 ' })).toBe(
			4096
		);
		expect(
			readArchiveObjectContentLength({
				get: (name: string) => (name === 'content-length' ? 8192 : null)
			})
		).toBe(8192);
	});

	it.each([undefined, null, '', '-1', '1.5', '1e3', '9007199254740992'])(
		'returns null for an unavailable or invalid length: %p',
		(value) => {
			expect(
				readArchiveObjectContentLength({ 'content-length': value })
			).toBeNull();
		}
	);
});

import { describe, expect, it, jest } from '@jest/globals';
import { copyExampleSource } from '../copy-example-source';

const source =
	'curl --data \'{"value":"<tag>&🙂"}\'\n  https://example.test/path\n';

describe('copying guide source', () => {
	it('copies every source byte without trimming or escaping', async () => {
		const writeText = jest
			.fn<(value: string) => Promise<void>>()
			.mockResolvedValue();
		await expect(
			copyExampleSource(source, () => ({ writeText }))
		).resolves.toBe('copied');
		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText).toHaveBeenCalledWith(source);
	});
	it('does not resolve success while the clipboard write is pending', async () => {
		let finish = (): void => {};
		let settled = false;
		const result = copyExampleSource(source, () => ({
			writeText: () =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		}));
		void result.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		finish();
		await expect(result).resolves.toBe('copied');
	});
	it('reports rejection without claiming a copy', async () => {
		await expect(
			copyExampleSource(source, () => ({
				writeText: async () => {
					throw new Error('Clipboard denied');
				}
			}))
		).resolves.toBe('failed');
	});
	it('reports missing clipboard access', async () => {
		await expect(copyExampleSource(source, () => undefined)).resolves.toBe(
			'unavailable'
		);
	});
	it('reports an unavailable write operation', async () => {
		await expect(copyExampleSource(source, () => ({}))).resolves.toBe(
			'unavailable'
		);
	});
	it('handles clipboard access errors without leaking their details', async () => {
		await expect(
			copyExampleSource(source, () => {
				throw new Error('Unavailable context');
			})
		).resolves.toBe('failed');
	});
});

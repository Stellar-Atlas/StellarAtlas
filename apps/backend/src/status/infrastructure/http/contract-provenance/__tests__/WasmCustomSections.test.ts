import { extractWasmCustomSections } from '../WasmCustomSections';

const encoder = new TextEncoder();
const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

function leb(value: number): number[] {
	const bytes: number[] = [];
	do {
		let byte = value & 0x7f;
		value >>>= 7;
		if (value) byte |= 0x80;
		bytes.push(byte);
	} while (value);
	return bytes;
}

function customSection(name: string, payload: number[]): number[] {
	const nameBytes = [...encoder.encode(name)];
	const body = [...leb(nameBytes.length), ...nameBytes, ...payload];
	return [0, ...leb(body.length), ...body];
}

describe('extractWasmCustomSections', () => {
	it('returns payloads for matching names and ignores unrelated custom sections', () => {
		const wasm = new Uint8Array([
			...header,
			...customSection('other', [9]),
			...customSection('source', [1, 2]),
			...customSection('source', [3])
		]);
		expect(
			extractWasmCustomSections(wasm, 'source').map((part) => [...part])
		).toEqual([[1, 2], [3]]);
	});

	it('skips non-custom sections and accepts padded u32 LEB lengths', () => {
		const section = customSection('source', [7]);
		const bodyLength = section[1]!;
		const paddedSection = [
			section[0]!,
			bodyLength | 0x80,
			0x00,
			...section.slice(2)
		];
		const wasm = new Uint8Array([...header, 1, 1, 0, ...paddedSection]);
		expect([...extractWasmCustomSections(wasm, 'source')[0]!]).toEqual([7]);
	});

	it('rejects truncated sections and overflowing LEB lengths', () => {
		expect(() =>
			extractWasmCustomSections(new Uint8Array([...header, 0, 2, 1]), 'x')
		).toThrow('Truncated Wasm section');
		expect(() =>
			extractWasmCustomSections(
				new Uint8Array([...header, 0, 0x80, 0x80, 0x80, 0x80, 0x10]),
				'x'
			)
		).toThrow('LEB128 value overflows u32');
	});

	it('rejects a wrong Wasm header and inputs over the size limit', () => {
		expect(() => extractWasmCustomSections(new Uint8Array(8), 'x')).toThrow(
			'Invalid Wasm v1 header'
		);
		expect(() =>
			extractWasmCustomSections(new Uint8Array(2 * 1024 * 1024 + 1), 'x')
		).toThrow('Wasm exceeds 2 MiB limit');
	});
});

import { createHash } from 'node:crypto';
import { readContractWasmMetadata } from '../ContractWasmMetadata';

const encoder = new TextEncoder();
const wasmHeader = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

function xdrString(value: string): number[] {
	const bytes = [...encoder.encode(value)];
	const padding = (4 - (bytes.length % 4)) % 4;
	return [
		(bytes.length >>> 24) & 0xff,
		(bytes.length >>> 16) & 0xff,
		(bytes.length >>> 8) & 0xff,
		bytes.length & 0xff,
		...bytes,
		...Array(padding).fill(0)
	];
}

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

function entry(key: string, value: string): number[] {
	return [0, 0, 0, 0, ...xdrString(key), ...xdrString(value)];
}

function wasmWithMetadata(...entries: number[][]): Uint8Array {
	const name = [...encoder.encode('contractmetav0')];
	const body = [...leb(name.length), ...name, ...entries.flat()];
	return new Uint8Array([...wasmHeader, 0, ...leb(body.length), ...body]);
}

function hash(wasm: Uint8Array): string {
	return createHash('sha256').update(wasm).digest('hex');
}

describe('readContractWasmMetadata', () => {
	it('reads source repository and home domain from hash-verified metadata', () => {
		const wasm = wasmWithMetadata(
			entry('source_repo', 'https://github.com/example/contract'),
			entry('home_domain', 'example.org')
		);
		expect(readContractWasmMetadata(wasm, hash(wasm))).toEqual({
			sourceRepository: 'https://github.com/example/contract',
			homeDomain: 'example.org'
		});
	});

	it('rejects a mismatched hash', () => {
		const wasm = wasmWithMetadata(entry('source_repo', 'repo'));
		expect(() => readContractWasmMetadata(wasm, '0'.repeat(64))).toThrow(
			'Wasm SHA-256 mismatch'
		);
	});

	it('rejects malformed XDR and conflicting repeated metadata', () => {
		const malformed = wasmWithMetadata([0, 0, 0, 0, 0, 0, 0, 1, 0x61, 1, 0, 0]);
		expect(() => readContractWasmMetadata(malformed, hash(malformed))).toThrow(
			'Metadata XDR padding must be zero'
		);
		const conflicting = wasmWithMetadata(
			entry('home_domain', 'one.example'),
			entry('home_domain', 'two.example')
		);
		expect(() =>
			readContractWasmMetadata(conflicting, hash(conflicting))
		).toThrow('Conflicting repeated home_domain metadata');
	});
});

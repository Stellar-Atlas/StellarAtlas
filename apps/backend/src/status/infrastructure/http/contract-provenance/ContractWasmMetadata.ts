import { createHash } from 'node:crypto';
import { extractWasmCustomSections } from './WasmCustomSections.js';

const metadataSectionName = 'contractmetav0';
const maxWasmBytes = 2 * 1024 * 1024;
const maxStringBytes = 16 * 1024;
const maxEntries = 128;
const decoder = new TextDecoder('utf-8', { fatal: true });

function invalid(reason: string): never {
	throw new Error(reason);
}

function readString(
	bytes: Uint8Array,
	view: DataView,
	offset: number,
	end: number
): { value: string; next: number } {
	if (offset + 4 > end) invalid('Truncated metadata string length');
	const length = view.getUint32(offset, false);
	if (length > maxStringBytes) invalid('Metadata string exceeds 16 KiB');
	const start = offset + 4;
	const paddedLength = (length + 3) & ~3;
	const next = start + paddedLength;
	if (next > end) invalid('Truncated metadata string');
	for (let index = start + length; index < next; index += 1)
		if (bytes[index] !== 0) invalid('Metadata XDR padding must be zero');
	let value: string;
	try {
		value = decoder.decode(bytes.subarray(start, start + length));
	} catch {
		invalid('Metadata string is not valid UTF-8');
	}
	return { value, next };
}

function readEntries(
	bytes: Uint8Array,
	metadata: Map<string, string>,
	count: { value: number }
): void {
	let offset = 0;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	while (offset < bytes.length) {
		count.value += 1;
		if (count.value > maxEntries) invalid('Too many metadata entries');
		if (offset + 4 > bytes.length) invalid('Truncated metadata entry tag');
		const tag = view.getInt32(offset, false);
		if (tag !== 0) invalid('Unknown metadata entry tag');
		offset += 4;
		const key = readString(bytes, view, offset, bytes.length);
		const value = readString(bytes, view, key.next, bytes.length);
		offset = value.next;
		if (key.value !== 'source_repo' && key.value !== 'home_domain') continue;
		const previous = metadata.get(key.value);
		if (previous !== undefined && previous !== value.value)
			invalid('Conflicting repeated ' + key.value + ' metadata');
		metadata.set(key.value, value.value);
	}
}

export function readContractWasmMetadata(
	wasm: Uint8Array,
	expectedSha256: string
): { sourceRepository: string | null; homeDomain: string | null } {
	if (!/^[a-f0-9]{64}$/.test(expectedSha256))
		invalid('Expected SHA-256 must be lowercase hexadecimal');
	if (wasm.length > maxWasmBytes) invalid('Wasm exceeds 2 MiB limit');
	const actualSha256 = createHash('sha256').update(wasm).digest('hex');
	if (actualSha256 !== expectedSha256) invalid('Wasm SHA-256 mismatch');
	const metadata = new Map<string, string>();
	const count = { value: 0 };
	for (const section of extractWasmCustomSections(wasm, metadataSectionName))
		readEntries(section, metadata, count);
	return {
		sourceRepository: metadata.get('source_repo') ?? null,
		homeDomain: metadata.get('home_domain') ?? null
	};
}

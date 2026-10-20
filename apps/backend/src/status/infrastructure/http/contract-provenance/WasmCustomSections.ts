const MAX_WASM_BYTES = 2 * 1024 * 1024;
const MAX_SECTIONS = 4096;
const MAX_NAME_BYTES = 256;
const MAX_MATCHES = 128;
const MAX_MATCHED_PAYLOAD_BYTES = 64 * 1024;
const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

function invalid(reason: string): never {
	throw new Error(reason);
}

function readU32Leb(
	bytes: Uint8Array,
	start: number,
	end: number
): {
	value: number;
	next: number;
} {
	let value = 0;
	for (let index = 0; index < 5; index += 1) {
		const offset = start + index;
		if (offset >= end) invalid('Truncated LEB128 value');
		const byte = bytes[offset]!;
		if (index === 4 && byte > 0x0f) invalid('LEB128 value overflows u32');
		value += (byte & 0x7f) * 2 ** (index * 7);
		if ((byte & 0x80) === 0) return { value, next: offset + 1 };
	}
	return invalid('LEB128 value exceeds five bytes');
}

export function extractWasmCustomSections(
	wasm: Uint8Array,
	name: string
): readonly Uint8Array[] {
	if (wasm.length > MAX_WASM_BYTES) invalid('Wasm exceeds 2 MiB limit');
	if (wasm.length < WASM_HEADER.length) invalid('Truncated Wasm header');
	for (let index = 0; index < WASM_HEADER.length; index += 1)
		if (wasm[index] !== WASM_HEADER[index]) invalid('Invalid Wasm v1 header');
	if (new TextEncoder().encode(name).length > MAX_NAME_BYTES)
		invalid('Custom section name exceeds 256 bytes');

	const decoder = new TextDecoder('utf-8', { fatal: true });
	const matches: Uint8Array[] = [];
	let matchedBytes = 0;
	let offset = WASM_HEADER.length;
	let sectionCount = 0;
	while (offset < wasm.length) {
		sectionCount += 1;
		if (sectionCount > MAX_SECTIONS) invalid('Wasm exceeds 4096 sections');
		const sectionId = wasm[offset++]!;
		const header = readU32Leb(wasm, offset, wasm.length);
		offset = header.next;
		const end = offset + header.value;
		if (end > wasm.length) invalid('Truncated Wasm section');
		if (sectionId === 0) {
			const nameLength = readU32Leb(wasm, offset, end);
			if (nameLength.value > MAX_NAME_BYTES)
				invalid('Custom section name exceeds 256 bytes');
			const nameEnd = nameLength.next + nameLength.value;
			if (nameEnd > end) invalid('Truncated custom section name');
			let sectionName: string;
			try {
				sectionName = decoder.decode(wasm.subarray(nameLength.next, nameEnd));
			} catch {
				invalid('Custom section name is not valid UTF-8');
			}
			if (sectionName === name) {
				const payloadLength = end - nameEnd;
				if (matches.length >= MAX_MATCHES)
					invalid('Too many matching custom sections');
				matchedBytes += payloadLength;
				if (matchedBytes > MAX_MATCHED_PAYLOAD_BYTES)
					invalid('Matching custom sections exceed 64 KiB');
				matches.push(wasm.subarray(nameEnd, end));
			}
		}
		offset = end;
	}
	return matches;
}

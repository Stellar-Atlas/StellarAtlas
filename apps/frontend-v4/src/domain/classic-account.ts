/** G/C StrKey: 33 payload bytes plus little-endian CRC16-XMODEM.
 * https://github.com/stellar/js-stellar-base/blob/master/src/strkey.js
 * This checks identity encoding, not whether the account exists on-chain.
 */
export function isClassicAccount(value: string): boolean {
	return validAccountEncoding(value, 'G', 48);
}

export function isContractAccount(value: string): boolean {
	return validAccountEncoding(value, 'C', 16);
}

function validAccountEncoding(value: string, prefix: 'G' | 'C', version: number): boolean {
	if (value[0] !== prefix || !/^[A-Z2-7]{56}$/.test(value)) return false;
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const bytes = new Uint8Array(35);
	let buffer = 0, bits = 0, position = 0;
	for (const character of value) {
		buffer = (buffer << 5) | alphabet.indexOf(character);
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes[position++] = (buffer >>> bits) & 255;
			buffer &= (1 << bits) - 1;
		}
	}
	if (position !== 35 || bytes[0] !== version) return false;
	let crc = 0;
	for (const byte of bytes.subarray(0, 33)) {
		crc ^= byte << 8;
		for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 32768 ? 0x1021 : 0)) & 65535;
	}
	return bytes[33] === (crc & 255) && bytes[34] === (crc >>> 8);
}

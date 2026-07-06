const archiveScanRouteBase = '/archive-scans';
const base64UrlAlphabet =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function getArchiveScanDetailPath(historyUrl: string): string {
	return `${archiveScanRouteBase}/${encodeArchiveScanRouteParam(historyUrl)}`;
}

export function decodeArchiveScanRouteParam(
	encodedHistoryUrl: string | readonly string[]
): string {
	const encodedValue =
		typeof encodedHistoryUrl === 'string'
			? encodedHistoryUrl
			: encodedHistoryUrl.join('/');

	const decodedBase64Url = decodeBase64Url(encodedValue);
	if (decodedBase64Url !== null) return decodedBase64Url;

	try {
		return decodeURIComponent(encodedValue);
	} catch {
		return encodedValue;
	}
}

function encodeArchiveScanRouteParam(historyUrl: string): string {
	const bytes = new TextEncoder().encode(historyUrl);
	let encodedValue = '';

	for (let index = 0; index < bytes.length; index += 3) {
		const first = bytes[index] ?? 0;
		const second = bytes[index + 1];
		const third = bytes[index + 2];

		encodedValue += base64UrlAlphabet[first >> 2];
		encodedValue +=
			base64UrlAlphabet[((first & 0b11) << 4) | ((second ?? 0) >> 4)];

		if (second !== undefined) {
			encodedValue +=
				base64UrlAlphabet[((second & 0b1111) << 2) | ((third ?? 0) >> 6)];
		}

		if (third !== undefined) {
			encodedValue += base64UrlAlphabet[third & 0b111111];
		}
	}

	return encodedValue;
}

function decodeBase64Url(encodedValue: string): string | null {
	if (
		encodedValue.length === 0 ||
		encodedValue.length % 4 === 1 ||
		!/^[A-Za-z0-9_-]+$/.test(encodedValue)
	) {
		return null;
	}

	try {
		const decodedValue = new TextDecoder().decode(
			decodeBase64UrlBytes(encodedValue)
		);
		return isProbablyArchiveUrl(decodedValue) ? decodedValue : null;
	} catch {
		return null;
	}
}

function decodeBase64UrlBytes(encodedValue: string): Uint8Array {
	let buffer = 0;
	let bitCount = 0;
	const bytes: number[] = [];

	for (const character of encodedValue) {
		const value = base64UrlAlphabet.indexOf(character);
		if (value === -1) throw new Error('Invalid base64url character');

		buffer = (buffer << 6) | value;
		bitCount += 6;

		if (bitCount >= 8) {
			bitCount -= 8;
			bytes.push((buffer >> bitCount) & 0xff);
		}
	}

	return new Uint8Array(bytes);
}

function isProbablyArchiveUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

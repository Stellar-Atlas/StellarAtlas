import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const communityScannerApiKeyPrefix = 'satlas_scanner_';
const communityScannerApiKeyByteLength = 32;
const communityScannerApiKeyHashEncoding = 'hex';

export function generateCommunityScannerApiKey(): string {
	return (
		communityScannerApiKeyPrefix +
		randomBytes(communityScannerApiKeyByteLength).toString('base64url')
	);
}

export function hashCommunityScannerApiKey(apiKey: string): string {
	return createHash('sha256')
		.update(apiKey, 'utf8')
		.digest(communityScannerApiKeyHashEncoding);
}

export function isCommunityScannerApiKeyMatch(
	apiKey: string,
	apiKeyHash: string
): boolean {
	const candidateHash = hashCommunityScannerApiKey(apiKey);
	const candidateBuffer = Buffer.from(
		candidateHash,
		communityScannerApiKeyHashEncoding
	);
	const storedBuffer = Buffer.from(
		apiKeyHash,
		communityScannerApiKeyHashEncoding
	);

	if (candidateBuffer.length !== storedBuffer.length) return false;

	return timingSafeEqual(candidateBuffer, storedBuffer);
}

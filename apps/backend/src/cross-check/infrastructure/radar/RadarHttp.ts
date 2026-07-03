import { createHash } from 'node:crypto';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';

export type RadarFetch = (
	input: string | URL,
	init?: RequestInit
) => Promise<Response>;

export interface RadarMaxBytesFailureDTO {
	readonly kind: 'max_bytes_exceeded';
	readonly limitBytes: number;
	readonly message: string;
}

export interface RadarNetworkFailureDTO {
	readonly kind: 'network_error' | 'timeout';
	readonly message: string;
}

export async function readBoundedRadarText(
	response: Response,
	maxBytes: number,
	sourceLabel: string
): Promise<Result<string, RadarMaxBytesFailureDTO>> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
		return err(createMaxBytesExceededFailure(sourceLabel, maxBytes));
	}

	if (!response.body) {
		const text = await response.text();
		if (Buffer.byteLength(text, 'utf8') > maxBytes) {
			return err(createMaxBytesExceededFailure(sourceLabel, maxBytes));
		}
		return ok(text);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let byteCount = 0;
	let text = '';

	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;

			byteCount += result.value.byteLength;
			if (byteCount > maxBytes) {
				await reader.cancel().catch(() => undefined);
				return err(createMaxBytesExceededFailure(sourceLabel, maxBytes));
			}
			text += decoder.decode(result.value, { stream: true });
		}

		text += decoder.decode();
		return ok(text);
	} finally {
		reader.releaseLock();
	}
}

export function hashSha256(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function mapRadarFetchError(error: unknown): RadarNetworkFailureDTO {
	const mappedError = mapUnknownToError(error);
	return {
		kind: isTimeoutError(error) ? 'timeout' : 'network_error',
		message: mappedError.message
	};
}

function createMaxBytesExceededFailure(
	sourceLabel: string,
	maxBytes: number
): RadarMaxBytesFailureDTO {
	return {
		kind: 'max_bytes_exceeded',
		limitBytes: maxBytes,
		message: `${sourceLabel} response exceeded ${maxBytes} bytes`
	};
}

function isTimeoutError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const name = 'name' in error ? error.name : undefined;
	return name === 'TimeoutError' || name === 'AbortError';
}

import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import type { HistoryArchiveRepairSourceUrlResolution } from '../database/HistoryArchiveRepairSourceUrlPolicy.js';

export interface RepairObjectHttpResponse {
	readonly body: Readable;
	readonly contentLength: number | null;
	readonly status: number;
}

export type RepairObjectHttpRequest = (
	resolution: HistoryArchiveRepairSourceUrlResolution,
	signal: AbortSignal
) => Promise<RepairObjectHttpResponse>;

export class RemoteHistoryArchiveResponseError extends Error {}

export async function requestPinnedRepairObject(
	resolution: HistoryArchiveRepairSourceUrlResolution,
	signal: AbortSignal
): Promise<RepairObjectHttpResponse> {
	const url = new URL(resolution.url);
	const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
	const response = await new Promise<IncomingMessage>(
		(resolveResponse, reject) => {
			const outgoing = request(
				url,
				{
					headers: {
						Accept: 'application/octet-stream',
						'User-Agent': 'StellarAtlas archive repair verifier'
					},
					lookup: pinnedLookup(resolution.addresses),
					method: 'GET',
					signal
				},
				resolveResponse
			);
			outgoing.once('error', reject);
			outgoing.end();
		}
	);
	return {
		body: response,
		contentLength: parseContentLength(response.headers['content-length']),
		status: response.statusCode ?? 0
	};
}

function pinnedLookup(addresses: readonly string[]): LookupFunction {
	const valid = addresses.flatMap((address) => {
		const family = isIP(address);
		return family === 4 || family === 6 ? [{ address, family }] : [];
	});
	if (valid.length === 0) throw new RemoteHistoryArchiveResponseError();
	return (_hostname, options, callback) => {
		if (options.all) {
			callback(null, valid);
			return;
		}
		const selected = valid.find((entry) =>
			options.family === 4 || options.family === 6
				? entry.family === options.family
				: true
		);
		if (selected === undefined) {
			callback(
				new Error('No validated address matches the requested family'),
				[]
			);
			return;
		}
		callback(null, selected.address, selected.family);
	};
}

function parseContentLength(
	value: string | string[] | undefined
): number | null {
	if (value === undefined) return null;
	if (Array.isArray(value) || !/^(0|[1-9][0-9]*)$/.test(value)) {
		throw new RemoteHistoryArchiveResponseError();
	}
	const length = Number(value);
	if (!Number.isSafeInteger(length)) {
		throw new RemoteHistoryArchiveResponseError();
	}
	return length;
}

import type { FullHistoryDecodedCheckpoint } from '../../../domain/full-history-promotion/FullHistoryCheckpointDecoder.js';
import {
	parseFullHistoryOperationWorkerDecodedCheckpoint,
	serializeFullHistoryOperationWorkerDecodedCheckpoint,
	type WireDecodedCheckpoint
} from './FullHistoryOperationWorkerDecodedCodec.js';
import {
	readWorkerInteger,
	readWorkerRecord,
	readWorkerString
} from './FullHistoryOperationWorkerValueParser.js';

export interface FullHistoryOperationWorkerMemory {
	readonly arrayBuffersBytes: number;
	readonly externalBytes: number;
	readonly heapUsedBytes: number;
}

interface SuccessfulWorkerResponse {
	readonly decoded: WireDecodedCheckpoint;
	readonly memory: FullHistoryOperationWorkerMemory;
	readonly status: 'completed';
}

interface FailedWorkerResponse {
	readonly memory: FullHistoryOperationWorkerMemory;
	readonly message: string;
	readonly status: 'failed';
}

export type FullHistoryOperationWorkerResponse =
	FailedWorkerResponse | SuccessfulWorkerResponse;

export type ParsedFullHistoryOperationWorkerResponse =
	| {
			readonly decoded: FullHistoryDecodedCheckpoint;
			readonly memory: FullHistoryOperationWorkerMemory;
			readonly status: 'completed';
	  }
	| {
			readonly memory: FullHistoryOperationWorkerMemory;
			readonly message: string;
			readonly status: 'failed';
	  };

export function successfulFullHistoryOperationWorkerResponse(
	decoded: FullHistoryDecodedCheckpoint
): SuccessfulWorkerResponse {
	return {
		decoded: serializeFullHistoryOperationWorkerDecodedCheckpoint(decoded),
		memory: currentWorkerMemory(),
		status: 'completed'
	};
}

export function failedFullHistoryOperationWorkerResponse(
	error: unknown
): FailedWorkerResponse {
	return {
		memory: currentWorkerMemory(),
		message: safeWorkerMessage(error),
		status: 'failed'
	};
}

export function parseFullHistoryOperationWorkerResponse(
	value: unknown
): ParsedFullHistoryOperationWorkerResponse {
	const response = readWorkerRecord(value, 'worker response');
	const memory = parseMemory(response.memory);
	if (response.status === 'completed') {
		return {
			decoded: parseFullHistoryOperationWorkerDecodedCheckpoint(
				response.decoded
			),
			memory,
			status: 'completed'
		};
	}
	if (response.status === 'failed') {
		return {
			memory,
			message: readWorkerString(
				response.message,
				'worker response message',
				384
			),
			status: 'failed'
		};
	}
	throw new TypeError('Worker response status is unsupported');
}

function currentWorkerMemory(): FullHistoryOperationWorkerMemory {
	const usage = process.memoryUsage();
	return {
		arrayBuffersBytes: usage.arrayBuffers,
		externalBytes: usage.external,
		heapUsedBytes: usage.heapUsed
	};
}

function parseMemory(value: unknown): FullHistoryOperationWorkerMemory {
	const memory = readWorkerRecord(value, 'worker memory');
	return {
		arrayBuffersBytes: readWorkerInteger(
			memory.arrayBuffersBytes,
			'worker memory arrayBuffersBytes',
			0,
			Number.MAX_SAFE_INTEGER
		),
		externalBytes: readWorkerInteger(
			memory.externalBytes,
			'worker memory externalBytes',
			0,
			Number.MAX_SAFE_INTEGER
		),
		heapUsedBytes: readWorkerInteger(
			memory.heapUsedBytes,
			'worker memory heapUsedBytes',
			0,
			Number.MAX_SAFE_INTEGER
		)
	};
}

function safeWorkerMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message
			.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]')
			.replace(/[\u0000-\u001f\u007f]/g, ' ')
			.slice(0, 384) || 'Worker decode failed'
	);
}

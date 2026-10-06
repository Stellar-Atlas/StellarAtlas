import {
	Url,
	isHttpError,
	type HttpOptions,
	type HttpService
} from 'http-helper';
import { err, ok, type Result } from 'neverthrow';
import { isObject } from 'shared';
import type { HistoryArchiveObjectCompletionItem } from '../../domain/scan/ScanCoordinatorService.js';
import { CoordinatorServiceError } from './CoordinatorServiceError.js';

type CompleteSingle = (
	item: HistoryArchiveObjectCompletionItem
) => Promise<Result<void, Error>>;
type Status = 'accepted' | 'stale' | 'retry';
interface CompletionResponse {
	readonly status: Status;
	readonly error?: string;
}

// The process terminal queue owns its existing W-sized occupancy and exactly
// one in-flight request. This transport adds no queue, timer or concurrency.
export async function requestHistoryArchiveObjectCompletions(
	httpService: HttpService,
	baseUrl: string,
	items: readonly HistoryArchiveObjectCompletionItem[],
	options: HttpOptions,
	completeSingle: CompleteSingle
): Promise<Result<readonly Result<void, Error>[], Error>> {
	if (items.length === 0) return ok([]);
	// Legacy workflows have no exact broker identities; preserve their original
	// single-object path instead of inventing acknowledgement identities.
	if (
		items.some(
			({ completion }) =>
				completion.scheduler !== 'broker' ||
				typeof completion.executionId !== 'string' ||
				completion.executionId.length === 0 ||
				!Number.isSafeInteger(completion.claimAttempt) ||
				Number(completion.claimAttempt) < 1
		)
	)
		return fallback(items, completeSingle);
	const url = Url.create(
		`${baseUrl}/v1/history-scan/archive-object-jobs/complete-batch`
	);
	if (url.isErr())
		return err(new CoordinatorServiceError('Invalid URL', url.error));
	const response = await httpService.post(
		url.value,
		{ items },
		{ ...options, responseType: 'json' }
	);
	const status = response.isOk()
		? response.value.status
		: isHttpError(response.error)
			? response.error.response?.status
			: undefined;
	// An old API or smaller current server batch limit is safe to downgrade.
	// Never retry an unchanged oversized batch, and never interpret outer404 as ACK.
	if (status === 404 || status === 413) return fallback(items, completeSingle);
	if (response.isErr())
		return err(
			new CoordinatorServiceError(
				'Failed to complete archive object batch',
				response.error
			)
		);
	if (status !== 200)
		return err(
			new CoordinatorServiceError(
				'Unexpected archive object batch response status'
			)
		);
	const parsed = validateResponse(items, response.value.data);
	if (parsed.isErr()) return err(parsed.error);
	// No accepted result escapes until EVERY identity, order and status validates.
	return ok(
		parsed.value.map((item) =>
			item.status === 'retry'
				? err(
						new CoordinatorServiceError(
							item.error ?? 'Archive object completion requires retry'
						)
					)
				: ok(undefined)
		)
	);
}

function validateResponse(
	input: readonly HistoryArchiveObjectCompletionItem[],
	value: unknown
): Result<readonly CompletionResponse[], Error> {
	if (
		!isRecord(value) ||
		!Array.isArray(value.items) ||
		value.items.length !== input.length
	)
		return invalidResponse();
	const output: CompletionResponse[] = [];
	for (let index = 0; index < input.length; index++) {
		const expected = input[index]!;
		const row: unknown = value.items[index];
		if (
			!isRecord(row) ||
			row.remoteId !== expected.remoteId ||
			row.executionId !== expected.completion.executionId ||
			row.claimAttempt !== expected.completion.claimAttempt ||
			(row.status !== 'accepted' &&
				row.status !== 'stale' &&
				row.status !== 'retry') ||
			(row.error !== undefined && typeof row.error !== 'string')
		)
			return invalidResponse();
		output.push({
			status: row.status,
			...(row.error === undefined ? {} : { error: row.error })
		});
	}
	return ok(output);
}

function invalidResponse(): Result<never, Error> {
	return err(
		new CoordinatorServiceError(
			'Invalid archive object batch response identity or format'
		)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fallback(
	items: readonly HistoryArchiveObjectCompletionItem[],
	completeSingle: CompleteSingle
): Promise<Result<readonly Result<void, Error>[], Error>> {
	const results: Result<void, Error>[] = [];
	// At most one fallback request is active; each original terminal result retains
	// the existing single-object status/token/idempotence handling.
	for (const item of items) results.push(await completeSingle(item));
	return ok(results);
}

export function isIdempotentMissingBrokerTerminalUpdate(
	action: 'heartbeat' | 'complete' | 'fail' | 'release',
	data: Record<string, unknown>,
	status: number | undefined,
	responseData: unknown
): boolean {
	return (
		(action === 'complete' || action === 'fail') &&
		data.scheduler === 'broker' &&
		typeof data.executionId === 'string' &&
		data.executionId.length > 0 &&
		typeof data.claimAttempt === 'number' &&
		Number.isSafeInteger(data.claimAttempt) &&
		data.claimAttempt > 0 &&
		status === 404 &&
		isObject(responseData) &&
		responseData.error === 'Archive object job not found'
	);
}

import { err, ok, Result } from 'neverthrow';
import {
	HttpQueue,
	type HttpQueueOptions,
	type QueueError,
	type Request
} from 'http-helper';
import { ScanError } from '../scan/ScanError.js';
import { mapHttpQueueErrorToScanError } from './mapHttpQueueErrorToScanError.js';
import {
	ArchiveScanErrorAccumulator,
	isCollectableArchiveVerificationError
} from './ArchiveScanErrorAccumulator.js';

type ResponseHandler<Meta extends Record<string, unknown>> = (
	result: unknown,
	request: Request<Meta>
) => Promise<Result<void, QueueError>>;

export interface CollectedArchiveRequestErrors {
	readonly errors: readonly ScanError[];
}

export async function sendRequestsCollectingArchiveErrors<
	Meta extends Record<string, unknown> = Record<string, unknown>
>(
	httpQueue: HttpQueue,
	requests: IterableIterator<Request<Meta>>,
	options: HttpQueueOptions,
	responseHandler?: ResponseHandler<Meta>,
	maxErrors = ArchiveScanErrorAccumulator.defaultMaxErrors
): Promise<Result<CollectedArchiveRequestErrors, ScanError>> {
	const accumulator = new ArchiveScanErrorAccumulator(maxErrors);
	const requestIterator = requests[Symbol.iterator]();
	const workerCount = Math.max(Math.floor(options.concurrency), 1);
	let fatalError: ScanError | undefined;

	const runWorker = async (): Promise<void> => {
		while (fatalError === undefined && !accumulator.isFull) {
			const nextRequest = requestIterator.next();
			if (nextRequest.done) return;

			const result = await httpQueue.sendRequests(
				[nextRequest.value].values(),
				createSingleRequestOptions(options),
				responseHandler
			);

			if (result.isOk()) continue;

			const scanError = mapHttpQueueErrorToScanError(result.error);
			if (isCollectableArchiveVerificationError(scanError)) {
				accumulator.add(scanError);
				continue;
			}

			fatalError = scanError;
		}
	};

	await Promise.all(Array.from({ length: workerCount }, runWorker));

	if (fatalError !== undefined) return err(fatalError);
	return ok({ errors: accumulator.values });
}

function createSingleRequestOptions(
	options: HttpQueueOptions
): HttpQueueOptions {
	const httpOptions = { ...options.httpOptions };
	delete httpOptions.abortSignal;

	return {
		...options,
		concurrency: 1,
		rampUpConnections: false,
		httpOptions
	};
}

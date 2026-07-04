import {
	FileNotFoundError,
	HttpError,
	QueueError,
	RequestMethod
} from 'http-helper';
import { createDummyHistoryBaseUrl } from '../../history-archive/__fixtures__/HistoryBaseUrl.js';
import { mapHttpQueueErrorToScanError } from '../mapHttpQueueErrorToScanError.js';
import { ScanError, ScanErrorType } from '../../scan/ScanError.js';

it('should map to scan error', function () {
	const error = new QueueError({
		url: createDummyHistoryBaseUrl(),
		meta: { checkPoint: 100 },
		method: RequestMethod.GET
	});

	const mappedError = mapHttpQueueErrorToScanError(error);

	expect(mappedError).toBeInstanceOf(ScanError);
});

it('File not found should map to verification error', function () {
	const error = new FileNotFoundError({
		url: createDummyHistoryBaseUrl(),
		meta: { checkPoint: 100 },
		method: RequestMethod.GET
	});

	const mappedError = mapHttpQueueErrorToScanError(error);

	expect(mappedError).toBeInstanceOf(ScanError);
	expect(mappedError.type).toEqual(ScanErrorType.TYPE_VERIFICATION);
});

it('HTTP client status should map to archive verification evidence', function () {
	const error = new QueueError(
		{
			url: createDummyHistoryBaseUrl(),
			meta: { checkPoint: 100 },
			method: RequestMethod.GET
		},
		new HttpError('Forbidden', undefined, {
			status: 403,
			statusText: 'Forbidden',
			data: {},
			headers: {}
		})
	);

	const mappedError = mapHttpQueueErrorToScanError(error);

	expect(mappedError).toBeInstanceOf(ScanError);
	expect(mappedError.type).toEqual(ScanErrorType.TYPE_VERIFICATION);
	expect(mappedError.message).toEqual('HTTP 403 Forbidden');
});

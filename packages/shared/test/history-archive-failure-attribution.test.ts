import { isHistoryArchiveInconclusiveTransportFailure as inconclusive } from '../src/history-archive-failure-attribution.js';

describe('archive failure attribution', () => {
	it.each([
		{
			errorType: 'archive_transport_error',
			httpStatus: 200,
			errorMessage: 'aborted'
		},
		{ errorType: 'HttpError', errorMessage: 'ERR_CANCELED: request canceled' },
		{ errorType: null, errorMessage: 'socket hang up ECONNRESET' },
		{ errorType: 'connection_timeout', errorMessage: 'connect failed' },
		{
			errorType: 'archive_http_error',
			httpStatus: 200,
			errorMessage: 'timeout of 10000ms exceeded'
		},
		{ errorType: 'ETIMEDOUT' },
		{ errorType: null, errorMessage: 'Error: UND_ERR_BODY_TIMEOUT' }
	])('marks interrupted exchanges inconclusive: %j', (input) =>
		expect(inconclusive(input)).toBe(true)
	);
	it.each([
		{
			httpStatus: 404,
			errorType: 'archive_transport_error',
			errorMessage: 'aborted'
		},
		{ httpStatus: 503, errorType: 'ETIMEDOUT' },
		{ httpStatus: 302, errorType: 'archive_http_error' },
		{
			httpStatus: 200,
			errorType: 'bucket_hash_mismatch',
			errorMessage: 'aborted'
		},
		{
			httpStatus: 200,
			errorType: 'category_content_invalid',
			errorMessage: 'connection timeout'
		},
		{ errorType: 'invalid_checkpoint_state', errorMessage: 'ECONNRESET' },
		{ errorType: 'worker_setup_failure', errorMessage: 'missing executable' },
		{ errorType: null, errorMessage: 'unexplained failure' }
	])('preserves explicit response/content/unknown evidence: %j', (input) =>
		expect(inconclusive(input)).toBe(false)
	);
});

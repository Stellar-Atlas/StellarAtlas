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
		{ errorType: 'HttpError', errorMessage: 'SB Connection time-out' },
		{ errorType: null, errorMessage: 'cancelled' },
		{ errorType: 'archive_http_error', errorMessage: 'canceled' },
		{ errorType: null, errorMessage: 'Error: cancelled.' },
		{},
		{ errorType: null, errorMessage: null },
		{ errorType: '', errorMessage: ' \t\n ' },
		{ errorType: 'unknown', errorMessage: '' },
		{ errorType: 'unknown_error', errorMessage: 'HttpError:' },
		{ errorType: 'Error', errorMessage: 'Error:' },
		{ errorType: 'HttpError', errorMessage: 'HttpError:   ' },
		{ errorType: ' HTTP-ERROR ', errorMessage: '\tHttpError:\n' },
		{ errorType: 'archive_http_error', httpStatus: 200, errorMessage: '' }
	])('keeps interrupted or empty generic exchanges inconclusive: %j', (input) =>
		expect(inconclusive(input)).toBe(true)
	);
	it.each([
		{ errorType: 'worker_setup_failure', errorMessage: '' },
		{ errorType: 'worker_configuration_error', errorMessage: 'HttpError:' },
		{ errorType: 'local_error', errorMessage: '' },
		{ errorType: 'missing_executable', errorMessage: null },
		{
			errorType: 'archive_http_error',
			errorMessage: 'HttpError: certificate rejected'
		},
		{ errorType: 'unknown', errorMessage: 'unexpected response body' },
		{ errorType: null, errorMessage: 'uncancelled request' },
		{ errorType: 'integrity_error', errorMessage: 'cancelled' },
		{ errorType: 'corrupt_bucket', errorMessage: 'SB Connection time-out' },
		{ errorType: 'decode_error', errorMessage: 'canceled' },
		{ errorType: 'xdr_error', errorMessage: 'HttpError:' },
		{ errorType: 'content_error', errorMessage: '' }
	])('does not erase explicit causes or guess a local fault: %j', (input) =>
		expect(inconclusive(input)).toBe(false)
	);
	it.each([300, 302, 404, 429, 500, 503, 599])(
		'preserves an explicit HTTP %i response even for generic blank/cancelled errors',
		(httpStatus) => {
			expect(
				inconclusive({ httpStatus, errorType: 'HttpError', errorMessage: '' })
			).toBe(false);
			expect(
				inconclusive({ httpStatus, errorType: null, errorMessage: 'cancelled' })
			).toBe(false);
		}
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

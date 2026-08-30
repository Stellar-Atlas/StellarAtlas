import { HttpError } from 'http-helper';
import {
	describeArchiveFailure,
	getRetryAfterSecondsFromHttpError
} from '../ArchiveObjectFailure.js';

describe('ArchiveObjectFailure Retry-After', () => {
	it('reads delta seconds from response headers', () => {
		const error = new HttpError('rate limited', undefined, {
			data: null,
			headers: { 'retry-after': '120' },
			status: 429,
			statusText: 'Too Many Requests'
		});

		expect(getRetryAfterSecondsFromHttpError(error)).toBe(120);
	});

	it('reads an HTTP date relative to the supplied clock', () => {
		const error = new HttpError('unavailable', undefined, {
			data: null,
			headers: { 'Retry-After': 'Mon, 06 Jul 2026 15:05:00 GMT' },
			status: 503,
			statusText: 'Service Unavailable'
		});

		expect(
			getRetryAfterSecondsFromHttpError(
				error,
				new Date('2026-07-06T15:00:00.000Z')
			)
		).toBe(300);
	});

	it('preserves a nested transport cause and machine error code', () => {
		const cause = Object.assign(new Error('socket closed'), {
			code: 'ECONNRESET'
		});
		const error = Object.assign(new Error('request failed'), { cause });

		expect(describeArchiveFailure(error)).toBe(
			'request failed; cause: socket closed; cause: code=ECONNRESET'
		);
	});
});

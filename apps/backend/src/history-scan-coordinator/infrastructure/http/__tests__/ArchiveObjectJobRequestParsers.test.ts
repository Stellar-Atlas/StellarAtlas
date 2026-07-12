import type express from 'express';
import { parseArchiveObjectFailure } from '../ArchiveObjectJobRequestParsers.js';

describe('parseArchiveObjectFailure', () => {
	it.each(['archive_evidence', 'scanner_issue'] as const)(
		'accepts the typed %s channel',
		(failureChannel) => {
			const response = createResponse();
			const result = parseArchiveObjectFailure(
				{
					body: {
						claimAttempt: 2,
						errorMessage: 'failure',
						errorType: 'misleading_error_name',
						failureChannel,
						httpStatus: null
					}
				} as unknown as express.Request,
				response.value
			);

			expect(result).toMatchObject({ failureChannel });
			expect(response.status).not.toHaveBeenCalled();
		}
	);

	it('rejects untyped legacy failures', () => {
		const response = createResponse();
		const result = parseArchiveObjectFailure(
			{
				body: {
					claimAttempt: 2,
					errorMessage: 'failure',
					errorType: 'worker_error'
				}
			} as unknown as express.Request,
			response.value
		);

		expect(result).toBeNull();
		expect(response.status).toHaveBeenCalledWith(400);
		expect(response.json).toHaveBeenCalledWith({
			error: 'failureChannel is invalid'
		});
	});
});

function createResponse() {
	const json = jest.fn();
	const status = jest.fn();
	const value = { json, status } as unknown as express.Response;
	status.mockReturnValue(value);
	return { json, status, value };
}

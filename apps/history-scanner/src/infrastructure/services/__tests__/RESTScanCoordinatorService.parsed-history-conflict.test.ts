import { err } from 'neverthrow';
import { mock } from 'jest-mock-extended';
import { HttpError, type HttpService } from 'http-helper';
import {
	ParsedLedgerHeaderBatchDTO,
	ParsedTransactionResultBatchDTO
} from 'history-scanner-dto';
import { CoordinatorServiceError } from '../CoordinatorServiceError.js';
import { ParsedHistoryRegistrationConflictError } from '../ParsedHistoryRegistrationConflictError.js';
import { RESTScanCoordinatorService } from '../RESTScanCoordinatorService.js';

describe('RESTScanCoordinatorService parsed history conflicts', () => {
	it('parses a coordinator 409 into a bounded archive-content error', async () => {
		const httpService = mock<HttpService>();
		httpService.post.mockResolvedValue(
			err(conflictHttpError({ ignored: 'not retained' }))
		);
		const service = createService(httpService);

		const result = await service.registerParsedLedgerHeaders(headerBatch());

		expect(result.isErr()).toBe(true);
		const conflict = result._unsafeUnwrapErr();
		expect(conflict).toBeInstanceOf(ParsedHistoryRegistrationConflictError);
		expect(conflict).toMatchObject({
			code: 'parsed_history_conflict',
			failureChannel: 'archive_evidence',
			identities: [
				{ ledgerHeaderHash: 'ledger-header-hash', ledgerSequence: 64 }
			],
			reason: 'stored-value-conflict'
		});
		expect(conflict).not.toHaveProperty('ignored');
	});

	it('does not trust a malformed 409 response as archive evidence', async () => {
		const httpService = mock<HttpService>();
		httpService.post.mockResolvedValue(
			err(
				conflictHttpError({
					identities: [
						{ ledgerHeaderHash: 'ledger-header-hash', ledgerSequence: '64' }
					]
				})
			)
		);
		const service = createService(httpService);

		const result = await service.registerParsedLedgerHeaders(headerBatch());

		expect(result._unsafeUnwrapErr()).toBeInstanceOf(CoordinatorServiceError);
	});

	it('parses an immutable transaction result conflict', async () => {
		const httpService = mock<HttpService>();
		httpService.post.mockResolvedValue(
			err(
				conflictHttpError({
					identities: [
						{
							category: 'result',
							categoryHash: 'transaction-result-hash',
							ledgerSequence: 64,
							transactionIndex: 2
						}
					]
				})
			)
		);
		const service = createService(httpService);

		const result =
			await service.registerParsedTransactionResults(resultBatch());

		expect(result._unsafeUnwrapErr()).toMatchObject({
			failureChannel: 'archive_evidence',
			identities: [
				{
					category: 'result',
					categoryHash: 'transaction-result-hash',
					ledgerSequence: 64,
					transactionIndex: 2
				}
			]
		});
	});
});

function createService(
	httpService: jest.Mocked<HttpService>
): RESTScanCoordinatorService {
	return new RESTScanCoordinatorService(
		httpService,
		'https://coordinator.example',
		{
			password: 'secret',
			type: 'internal',
			username: 'admin'
		}
	);
}

function conflictHttpError(
	errorOverrides: Record<string, unknown> = {}
): HttpError {
	return new HttpError('Request failed with status code 409', undefined, {
		data: {
			error: {
				code: 'parsed_history_conflict',
				failureChannel: 'archive_evidence',
				identities: [
					{ ledgerHeaderHash: 'ledger-header-hash', ledgerSequence: 64 }
				],
				message:
					'Parsed ledger header stored-value-conflict for 64:ledger-header-hash',
				reason: 'stored-value-conflict',
				...errorOverrides
			}
		},
		headers: {},
		status: 409,
		statusText: 'Conflict'
	});
}

function headerBatch(): ParsedLedgerHeaderBatchDTO {
	return new ParsedLedgerHeaderBatchDTO(
		'https://archive.example',
		'object-remote-id',
		new Date('2026-07-11T12:00:00.000Z'),
		[
			{
				bucketListHash: 'bucket-list-hash',
				closedAt: '2026-07-11T11:59:59.000Z',
				ledgerHeaderHash: 'ledger-header-hash',
				ledgerSequence: 64,
				previousLedgerHeaderHash: 'previous-ledger-header-hash',
				protocolVersion: 27,
				transactionResultHash: 'transaction-result-hash',
				transactionSetHash: 'transaction-set-hash'
			}
		]
	);
}

function resultBatch(): ParsedTransactionResultBatchDTO {
	return new ParsedTransactionResultBatchDTO(
		'https://archive.example',
		'object-remote-id',
		new Date('2026-07-11T12:00:00.000Z'),
		[
			{
				ledgerSequence: 64,
				resultXdr: 'AAAA-result',
				transactionHash: 'transaction-hash',
				transactionIndex: 2,
				transactionResultHash: 'transaction-result-hash'
			}
		]
	);
}

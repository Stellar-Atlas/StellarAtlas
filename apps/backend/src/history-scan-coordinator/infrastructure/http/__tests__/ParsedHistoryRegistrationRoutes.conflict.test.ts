import 'reflect-metadata';
import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err } from 'neverthrow';
import { ParsedLedgerHeaderConflictError } from '../../../domain/parsed-history/ParsedLedgerHeaderConflictError.js';
import { ParsedTransactionConflictError } from '../../../domain/parsed-history/ParsedTransactionConflictError.js';
import { RegisterParsedLedgerHeaders } from '../../../use-cases/register-parsed-ledger-headers/RegisterParsedLedgerHeaders.js';
import { RegisterParsedTransactionEnvelopes } from '../../../use-cases/register-parsed-transaction-envelopes/RegisterParsedTransactionEnvelopes.js';
import { RegisterParsedTransactionResults } from '../../../use-cases/register-parsed-transaction-results/RegisterParsedTransactionResults.js';
import { registerParsedHistoryRegistrationRoutes } from '../ParsedHistoryRegistrationRoutes.js';

describe('parsed history registration conflict responses', () => {
	it('returns an archive-evidence 409 for a stored content conflict', async () => {
		const conflict = new ParsedLedgerHeaderConflictError(
			'stored-value-conflict',
			[{ ledgerHeaderHash: 'ledger-header-hash', ledgerSequence: 64 }]
		);
		const { app, registerParsedLedgerHeaders } = createHarness();
		registerParsedLedgerHeaders.execute.mockResolvedValue(err(conflict));

		await request(app)
			.post('/history-scan/parsed-ledger-headers')
			.auth('admin', 'secret')
			.send(validHeaderBatch())
			.expect(409)
			.expect({
				error: {
					code: 'parsed_history_conflict',
					failureChannel: 'archive_evidence',
					identities: [
						{ ledgerHeaderHash: 'ledger-header-hash', ledgerSequence: 64 }
					],
					message: conflict.message,
					reason: 'stored-value-conflict'
				}
			});
	});

	it('keeps unrelated registration failures as internal errors', async () => {
		const { app, registerParsedLedgerHeaders } = createHarness();
		registerParsedLedgerHeaders.execute.mockResolvedValue(
			err(new Error('database unavailable'))
		);

		await request(app)
			.post('/history-scan/parsed-ledger-headers')
			.auth('admin', 'secret')
			.send(validHeaderBatch())
			.expect(500)
			.expect({ error: 'database unavailable' });
	});

	it('returns archive evidence for an immutable transaction result conflict', async () => {
		const conflict = new ParsedTransactionConflictError(
			'stored-value-conflict',
			[
				{
					category: 'result',
					categoryHash: 'transaction-result-hash',
					ledgerSequence: 64,
					transactionIndex: 2
				}
			]
		);
		const { app, registerParsedTransactionResults } = createHarness();
		registerParsedTransactionResults.execute.mockResolvedValue(err(conflict));

		await request(app)
			.post('/history-scan/parsed-transaction-results')
			.auth('admin', 'secret')
			.send(validResultBatch())
			.expect(409)
			.expect({
				error: {
					code: 'parsed_history_conflict',
					failureChannel: 'archive_evidence',
					identities: [
						{
							category: 'result',
							categoryHash: 'transaction-result-hash',
							ledgerSequence: 64,
							transactionIndex: 2
						}
					],
					message: conflict.message,
					reason: 'stored-value-conflict'
				}
			});
	});

	it('does not emit an invalid empty conflict contract', async () => {
		const conflict = new ParsedLedgerHeaderConflictError(
			'stored-value-conflict',
			[]
		);
		const { app, registerParsedLedgerHeaders } = createHarness();
		registerParsedLedgerHeaders.execute.mockResolvedValue(err(conflict));

		await request(app)
			.post('/history-scan/parsed-ledger-headers')
			.auth('admin', 'secret')
			.send(validHeaderBatch())
			.expect(500)
			.expect({ error: conflict.message });
	});
});

function createHarness(): {
	readonly app: express.Application;
	readonly registerParsedLedgerHeaders: jest.Mocked<RegisterParsedLedgerHeaders>;
	readonly registerParsedTransactionResults: jest.Mocked<RegisterParsedTransactionResults>;
} {
	const registerParsedLedgerHeaders = mock<RegisterParsedLedgerHeaders>();
	const registerParsedTransactionResults =
		mock<RegisterParsedTransactionResults>();
	const router = express.Router();
	registerParsedHistoryRegistrationRoutes(router, {
		password: 'secret',
		registerParsedLedgerHeaders,
		registerParsedTransactionEnvelopes:
			mock<RegisterParsedTransactionEnvelopes>(),
		registerParsedTransactionResults,
		userName: 'admin'
	});
	const app = express();
	app.use(express.json());
	app.use('/history-scan', router);
	return { app, registerParsedLedgerHeaders, registerParsedTransactionResults };
}

function validHeaderBatch(): Record<string, unknown> {
	return {
		headers: [
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
		],
		observedAt: '2026-07-11T12:00:00.000Z',
		scanJobRemoteId: 'object-remote-id',
		sourceArchiveUrl: 'https://archive.example'
	};
}

function validResultBatch(): Record<string, unknown> {
	return {
		observedAt: '2026-07-11T12:00:00.000Z',
		records: [
			{
				ledgerSequence: 64,
				resultXdr: 'AAAA-result',
				transactionHash: 'transaction-hash',
				transactionIndex: 2,
				transactionResultHash: 'transaction-result-hash'
			}
		],
		scanJobRemoteId: 'object-remote-id',
		sourceArchiveUrl: 'https://archive.example'
	};
}

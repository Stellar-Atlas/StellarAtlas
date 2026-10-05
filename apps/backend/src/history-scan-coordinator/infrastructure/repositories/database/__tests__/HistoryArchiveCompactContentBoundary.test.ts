import type express from 'express';
import {
	parseArchiveObjectCompletion,
	parseArchiveObjectFailure,
	parseArchiveObjectProgress
} from '../../../http/ArchiveObjectJobRequestParsers.js';
import { mapPublicVerificationFacts } from '../../../mappers/PublicArchiveObjectFactsMapper.js';

describe('shared facts remain server-managed', () => {
	it.each([
		{ contentReference: {} },
		{ ledgerCategory: { sharedSummary: {} } },
		{ transactionsCategory: { sharedSummary: {} } },
		{ resultsCategory: { sharedSummary: {} } }
	])(
		'rejects reserved persisted fields on every worker write route',
		(verificationFacts) => {
			for (const parse of [
				parseArchiveObjectProgress,
				parseArchiveObjectCompletion,
				parseArchiveObjectFailure
			]) {
				const response = { status: jest.fn(), json: jest.fn() };
				response.status.mockReturnValue(response);
				const request = {
					body: {
						claimAttempt: 1,
						errorType: 'failure',
						errorMessage: 'failure',
						failureChannel: 'archive_evidence',
						verificationFacts
					}
				} as express.Request;
				expect(
					parse(request, response as unknown as express.Response)
				).toBeNull();
				expect(response.status).toHaveBeenCalledWith(400);
			}
		}
	);
	it('does not let a supplied summary override actual arrays or legacy public counts', () => {
		const mapped = mapPublicVerificationFacts({
			transactionsCategory: {
				entryCount: 2,
				ledgers: [{ ledger: 8 }, { ledger: 9 }],
				sharedSummary: { ledgerCount: 100, firstLedger: 1, lastLedger: 100 }
			}
		});
		expect(mapped?.transactionsCategory).toEqual({
			entryCount: 2,
			ledgerCount: 2,
			firstLedger: 8,
			lastLedger: 9
		});
		expect(
			mapPublicVerificationFacts({
				transactionsCategory: {
					entryCount: 2,
					sharedSummary: { ledgerCount: 100, firstLedger: 1, lastLedger: 100 }
				}
			})?.transactionsCategory
		).toEqual({
			entryCount: 2,
			ledgerCount: 0,
			firstLedger: null,
			lastLedger: null
		});
	});
});

import bodyParser from 'body-parser';
import type { Express } from 'express';
import { parsedHistoryRequestBodyLimitBytes } from 'history-scanner-dto';

export const parsedHistoryRegistrationPaths = [
	'/v1/history-scan/parsed-ledger-headers',
	'/v1/history-scan/parsed-transaction-envelopes',
	'/v1/history-scan/parsed-transaction-results'
] as const;

export function mountParsedHistoryRequestBodyParser(
	api: Express,
	limitBytes = parsedHistoryRequestBodyLimitBytes
): void {
	if (
		!Number.isSafeInteger(limitBytes) ||
		limitBytes < 1 ||
		limitBytes > parsedHistoryRequestBodyLimitBytes
	) {
		throw new RangeError(
			`Parsed history request body limit must be between 1 and ${parsedHistoryRequestBodyLimitBytes}`
		);
	}

	api.use(
		[...parsedHistoryRegistrationPaths],
		bodyParser.json({ limit: limitBytes })
	);
}

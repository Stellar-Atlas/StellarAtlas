import type express from 'express';
import basicAuth from 'express-basic-auth';
import {
	ParsedLedgerHeaderBatchDTO,
	ParsedTransactionEnvelopeBatchDTO,
	ParsedTransactionResultBatchDTO
} from 'history-scanner-dto';
import { RegisterParsedLedgerHeaders } from '../../use-cases/register-parsed-ledger-headers/RegisterParsedLedgerHeaders.js';
import { RegisterParsedTransactionEnvelopes } from '../../use-cases/register-parsed-transaction-envelopes/RegisterParsedTransactionEnvelopes.js';
import { RegisterParsedTransactionResults } from '../../use-cases/register-parsed-transaction-results/RegisterParsedTransactionResults.js';
import { requireObjectBody } from './ScanRequestValidation.js';
import { mapParsedHistoryRegistrationConflict } from './ParsedHistoryRegistrationConflictResponse.js';

export interface ParsedHistoryRegistrationRouteConfig {
	registerParsedLedgerHeaders: RegisterParsedLedgerHeaders;
	registerParsedTransactionEnvelopes: RegisterParsedTransactionEnvelopes;
	registerParsedTransactionResults: RegisterParsedTransactionResults;
	userName?: string;
	password?: string;
}

export function registerParsedHistoryRegistrationRoutes(
	router: express.Router,
	config: ParsedHistoryRegistrationRouteConfig
): void {
	if (!config.userName || !config.password) return;

	const auth = basicAuth({
		challenge: true,
		users: { [config.userName]: config.password }
	});

	router.post(
		'/parsed-ledger-headers',
		auth,
		requireObjectBody,
		async (req: express.Request, res: express.Response) => {
			const dtoResult = ParsedLedgerHeaderBatchDTO.fromJSON(req.body);
			if (dtoResult.isErr()) {
				return res.status(400).json({ error: dtoResult.error.message });
			}

			const result = await config.registerParsedLedgerHeaders.execute(
				dtoResult.value
			);
			if (result.isErr()) {
				return sendRegistrationError(res, result.error);
			}

			return res.status(201).json({
				message: 'Parsed ledger headers registered'
			});
		}
	);

	router.post(
		'/parsed-transaction-envelopes',
		auth,
		requireObjectBody,
		async (req: express.Request, res: express.Response) => {
			const dtoResult = ParsedTransactionEnvelopeBatchDTO.fromJSON(req.body);
			if (dtoResult.isErr()) {
				return res.status(400).json({ error: dtoResult.error.message });
			}

			const result = await config.registerParsedTransactionEnvelopes.execute(
				dtoResult.value
			);
			if (result.isErr()) {
				return sendRegistrationError(res, result.error);
			}

			return res.status(201).json({
				message: 'Parsed transaction envelopes registered'
			});
		}
	);

	router.post(
		'/parsed-transaction-results',
		auth,
		requireObjectBody,
		async (req: express.Request, res: express.Response) => {
			const dtoResult = ParsedTransactionResultBatchDTO.fromJSON(req.body);
			if (dtoResult.isErr()) {
				return res.status(400).json({ error: dtoResult.error.message });
			}

			const result = await config.registerParsedTransactionResults.execute(
				dtoResult.value
			);
			if (result.isErr()) {
				return sendRegistrationError(res, result.error);
			}

			return res.status(201).json({
				message: 'Parsed transaction results registered'
			});
		}
	);
}

function sendRegistrationError(
	res: express.Response,
	error: Error
): express.Response {
	const conflict = mapParsedHistoryRegistrationConflict(error);
	return conflict === null
		? res.status(500).json({ error: error.message })
		: res.status(409).json(conflict);
}

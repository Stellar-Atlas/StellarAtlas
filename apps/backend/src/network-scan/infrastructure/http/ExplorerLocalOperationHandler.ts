import type express from 'express';
import {
	isFullHistoryOperationSourceAccount,
	isFullHistoryOperationType,
	type FullHistoryOperationQuery
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalOperation.js';
import {
	fullHistoryLedgerSequence,
	FullHistoryHash
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import type { GetExplorerLocalTransactions } from '../../use-cases/get-explorer-local-transactions/GetExplorerLocalTransactions.js';
import { isTransactionHash } from './BlockchainExplorerClient.js';

const localOperationCacheMaxAgeSeconds = 20;
const defaultOperationLimit = 50;
const maximumOperationLimit = 100;

export function createExplorerLocalOperationHandler(
	useCase: Pick<GetExplorerLocalTransactions, 'findOperations'>
): express.RequestHandler {
	return async (req, res) => {
		const query = readOperationQuery(req);
		if (query === null) {
			return res.status(400).json({ error: 'Invalid local operation filters' });
		}

		res.setHeader(
			'Cache-Control',
			`public, max-age=${localOperationCacheMaxAgeSeconds}`
		);
		try {
			return res.status(200).json(await useCase.findOperations(query));
		} catch {
			return res
				.status(502)
				.json({ error: 'Explorer local operations unavailable' });
		}
	};
}

function readOperationQuery(req: express.Request): FullHistoryOperationQuery | null {
	const firstLedger = readOptionalString(req.query.firstLedger);
	const lastLedger = readOptionalString(req.query.lastLedger);
	const operationType = readOptionalString(req.query.operationType);
	const sourceAccount = readOptionalString(req.query.sourceAccount);
	const transactionHash = readOptionalString(req.query.transactionHash);
	const limit = readLimit(req.query.limit);
	if (
		limit === null ||
		(operationType !== undefined &&
			!isFullHistoryOperationType(operationType)) ||
		(sourceAccount !== undefined &&
			!isFullHistoryOperationSourceAccount(sourceAccount)) ||
		(transactionHash !== undefined && !isTransactionHash(transactionHash))
	) {
		return null;
	}

	const first = parseLedger(firstLedger);
	const last = parseLedger(lastLedger);
	if (
		(firstLedger !== undefined && first === null) ||
		(lastLedger !== undefined && last === null) ||
		(first !== null && last !== null && BigInt(first) > BigInt(last))
	) {
		return null;
	}

	return {
		...(first === null ? {} : { firstLedger: first }),
		...(last === null ? {} : { lastLedger: last }),
		limit,
		...(operationType === undefined ? {} : { operationType }),
		...(sourceAccount === undefined ? {} : { sourceAccount }),
		...(transactionHash === undefined
			? {}
			: { transactionHash: FullHistoryHash.fromHex(transactionHash) })
	};
}

function parseLedger(value: string | undefined) {
	if (value === undefined) return null;
	try {
		return fullHistoryLedgerSequence(value);
	} catch {
		return null;
	}
}

function readLimit(value: unknown): number | null {
	if (value === undefined) return defaultOperationLimit;
	if (typeof value !== 'string') return null;
	const limit = Number(value);
	return Number.isSafeInteger(limit) && limit >= 1 && limit <= maximumOperationLimit
		? limit
		: null;
}

function readOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;
}

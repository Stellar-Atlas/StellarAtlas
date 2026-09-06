import type {
	HubbleTransactionInput,
	HubbleTransactionRelation
} from './HubbleTransactionContracts.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';

export interface TransactionPosition {
	readonly key: string;
	readonly index: number;
	readonly row: string;
	readonly batch: string;
	readonly digest: string;
}
interface TransactionCursor {
	readonly version: 1;
	readonly hash: string;
	readonly ledger: number;
	readonly transactionId: string;
	readonly relation: HubbleTransactionRelation;
	readonly position: TransactionPosition;
}
export function normalizeTransactionInput(
	input: HubbleTransactionInput
): HubbleTransactionInput {
	if (
		typeof input.transactionHash !== 'string' ||
		!/^[a-fA-F0-9]{64}$/.test(input.transactionHash)
	)
		throw new HubbleWarehouseInputError(
			'transactionHash must be a 64-character hexadecimal hash'
		);
	if (
		input.ledgerSequence !== undefined &&
		(!Number.isSafeInteger(input.ledgerSequence) ||
			input.ledgerSequence < 1 ||
			input.ledgerSequence > 2147483647)
	)
		throw new HubbleWarehouseInputError(
			'ledgerSequence must be an integer between 1 and 2147483647'
		);
	const limit = input.limit ?? 25;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
		throw new HubbleWarehouseInputError(
			'limit must be an integer between 1 and 200'
		);
	for (const key of ['operationsAfter', 'effectsAfter', 'eventsAfter'] as const)
		if (
			input[key] !== undefined &&
			(typeof input[key] !== 'string' ||
				input[key]!.length < 1 ||
				input[key]!.length > 2048)
		)
			throw new HubbleWarehouseInputError(
				key + ' must be an opaque transaction cursor'
			);
	return {
		...input,
		transactionHash: input.transactionHash.toLowerCase(),
		limit
	};
}
export function encodeTransactionCursor(cursor: TransactionCursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
export function decodeTransactionCursor(
	value: string | undefined,
	scope: Omit<TransactionCursor, 'position' | 'version'>
): TransactionPosition | undefined {
	if (value === undefined) return undefined;
	try {
		if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value))
			throw new Error();
		const decoded: unknown = JSON.parse(
			Buffer.from(value, 'base64url').toString('utf8')
		);
		if (
			!record(decoded) ||
			decoded.version !== 1 ||
			decoded.hash !== scope.hash ||
			decoded.ledger !== scope.ledger ||
			decoded.transactionId !== scope.transactionId ||
			decoded.relation !== scope.relation ||
			!record(decoded.position)
		)
			throw new Error();
		const p = decoded.position;
		if (
			!unsigned(p.key, 9223372036854775807n) ||
			!unsigned(p.row, 18446744073709551615n) ||
			!Number.isSafeInteger(p.index) ||
			(p.index as number) < 0 ||
			(p.index as number) > 4294967295 ||
			typeof p.batch !== 'string' ||
			!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(p.batch) ||
			typeof p.digest !== 'string' ||
			!/^[a-f0-9]{64}$/.test(p.digest)
		)
			throw new Error();
		const position = p as unknown as TransactionPosition;
		if (scope.relation !== 'effects' && position.index !== 0) throw new Error();
		if (
			scope.relation === 'operations' &&
			(BigInt(position.key) <= BigInt(scope.transactionId) ||
				BigInt(position.key) > BigInt(scope.transactionId) + 100n)
		)
			throw new Error();
		if (
			scope.relation === 'effects' &&
			(BigInt(position.key) <= BigInt(scope.transactionId) ||
				BigInt(position.key) > BigInt(scope.transactionId) + 100n)
		)
			throw new Error();
		if (scope.relation === 'events' && position.key !== scope.transactionId)
			throw new Error();
		return position;
	} catch {
		throw new HubbleWarehouseInputError(
			'Invalid transaction relation cursor or mismatched transaction/relation'
		);
	}
}
function unsigned(value: unknown, maximum: bigint): value is string {
	return (
		typeof value === 'string' &&
		/^(0|[1-9][0-9]{0,19})$/.test(value) &&
		BigInt(value) <= maximum
	);
}
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

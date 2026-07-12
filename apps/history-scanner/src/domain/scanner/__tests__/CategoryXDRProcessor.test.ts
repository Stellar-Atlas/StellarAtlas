import { Url } from 'http-helper';
import { Category } from '../../history-archive/Category.js';
import type { CategoryVerificationData } from '../CategoryScanner.js';
import { CategoryXDRProcessor } from '../CategoryXDRProcessor.js';
import { ArchiveXdrError } from '../hash-worker.js';
import type { HasherPool } from '../HasherPool.js';
import { ScannerIssueError } from '../ScannerIssueError.js';
import type {
	ParsedHistoryRecord,
	ParsedHistorySink
} from '../parsed-history/ParsedHistorySink.js';

it('should apply workerpool results before acknowledging a write', async () => {
	let resolveExec: ((value: unknown) => void) | undefined;
	const exec = jest.fn(
		() =>
			new Promise((resolve) => {
				resolveExec = resolve;
			})
	);
	const processor = newProcessor(
		Category.transactions,
		createPool(exec),
		createVerificationData()
	);

	const writePromise = writeXdr(processor);
	await Promise.resolve();
	expect(processor.categoryVerificationData.calculatedTxSetHashes.size).toBe(0);

	if (resolveExec === undefined) throw new Error('workerpool was not called');
	resolveExec({ ledger: 7, hash: 'tx-set-hash', envelopes: [] });
	await writePromise;

	expect(processor.categoryVerificationData.calculatedTxSetHashes.get(7)).toBe(
		'tx-set-hash'
	);
});

it('should classify workerpool failures as scanner infrastructure', async () => {
	const error = new Error('hash worker failed');
	const exec = jest.fn(async () => {
		throw error;
	});
	const processor = newProcessor(
		Category.transactions,
		createPool(exec),
		createVerificationData()
	);

	await expect(writeXdr(processor)).rejects.toBeInstanceOf(ScannerIssueError);
	await expect(
		writeXdr(
			newProcessor(
				Category.transactions,
				createPool(exec),
				createVerificationData()
			)
		)
	).rejects.toMatchObject({
		cause: error,
		message: 'Worker pool failed to process archive data'
	});
});

it('should preserve malformed archive XDR as archive content evidence', async () => {
	const error = new ArchiveXdrError('Invalid transaction envelope archive XDR');
	const exec = jest.fn(async () => {
		throw error;
	});
	const processor = newProcessor(
		Category.transactions,
		createPool(exec),
		createVerificationData()
	);

	await expect(writeXdr(processor)).rejects.toBe(error);
	const serializedError = new Error(error.message);
	serializedError.name = error.name;
	await expect(
		writeXdr(
			newProcessor(
				Category.transactions,
				createPool(async () => {
					throw serializedError;
				}),
				createVerificationData()
			)
		)
	).rejects.toMatchObject({
		message: error.message,
		name: 'ArchiveXdrError'
	});
});

it('should emit parsed ledger header records while preserving verification data', async () => {
	const ledgerHeaderResult = {
		closedAt: '2026-07-05T01:42:50.000Z',
		ledger: 127,
		transactionsHash: 'transactions-hash',
		transactionResultsHash: 'transaction-results-hash',
		previousLedgerHeaderHash: 'previous-ledger-header-hash',
		ledgerHeaderHash: 'ledger-header-hash',
		bucketListHash: 'bucket-list-hash',
		protocolVersion: 22
	};
	const emit = jest.fn<void, [ParsedHistoryRecord]>();
	const exec = jest.fn(async () => ledgerHeaderResult);
	const verificationData = createVerificationData();
	const processor = newProcessor(
		Category.ledger,
		createPool(exec),
		verificationData,
		{ emit }
	);

	await writeXdr(processor);

	expect(emit).toHaveBeenCalledWith({
		closedAt: '2026-07-05T01:42:50.000Z',
		recordType: 'ledger-header',
		sourceUrl: 'https://history.example',
		ledger: 127,
		protocolVersion: 22,
		ledgerHeaderHash: 'ledger-header-hash',
		previousLedgerHeaderHash: 'previous-ledger-header-hash',
		transactionSetHash: 'transactions-hash',
		transactionResultSetHash: 'transaction-results-hash',
		bucketListHash: 'bucket-list-hash'
	});
	expect(verificationData.expectedHashesPerLedger.get(127)).toEqual({
		txSetResultHash: 'transaction-results-hash',
		txSetHash: 'transactions-hash',
		previousLedgerHeaderHash: 'previous-ledger-header-hash',
		bucketListHash: 'bucket-list-hash'
	});
	expect(verificationData.calculatedLedgerHeaderHashes.get(127)).toBe(
		'ledger-header-hash'
	);
	expect(verificationData.protocolVersions.get(127)).toBe(22);
});

it('should emit parsed transaction envelope records', async () => {
	const emit = jest.fn<void, [ParsedHistoryRecord]>();
	const exec = jest.fn(async () => ({
		ledger: 7,
		hash: 'tx-set-hash',
		envelopes: [
			{
				envelopeXdr: 'AAAA-envelope',
				transactionIndex: 2
			}
		]
	}));
	const verificationData = createVerificationData();
	const processor = newProcessor(
		Category.transactions,
		createPool(exec),
		verificationData,
		{ emit }
	);

	await writeXdr(processor);

	expect(verificationData.calculatedTxSetHashes.get(7)).toBe('tx-set-hash');
	expect(emit).toHaveBeenCalledWith({
		recordType: 'transaction-envelope',
		sourceUrl: 'https://history.example',
		ledger: 7,
		transactionIndex: 2,
		transactionSetHash: 'tx-set-hash',
		envelopeXdr: 'AAAA-envelope'
	});
});

it('should emit parsed transaction result records', async () => {
	const emit = jest.fn<void, [ParsedHistoryRecord]>();
	const exec = jest.fn(async () => ({
		ledger: 7,
		hash: 'tx-result-hash',
		results: [
			{
				resultXdr: 'AAAA-result',
				transactionHash: 'transaction-hash',
				transactionIndex: 1
			}
		]
	}));
	const verificationData = createVerificationData();
	const processor = newProcessor(
		Category.results,
		createPool(exec),
		verificationData,
		{ emit }
	);

	await writeXdr(processor);

	expect(verificationData.calculatedTxSetResultHashes.get(7)).toBe(
		'tx-result-hash'
	);
	expect(emit).toHaveBeenCalledWith({
		recordType: 'transaction-result',
		sourceUrl: 'https://history.example',
		ledger: 7,
		transactionIndex: 1,
		transactionResultHash: 'tx-result-hash',
		transactionHash: 'transaction-hash',
		resultXdr: 'AAAA-result'
	});
});

it('should validate scp frames through the worker pool', async () => {
	const exec = jest.fn(async () => undefined);
	const processor = newProcessor(
		Category.scp,
		createPool(exec),
		createVerificationData()
	);

	await writeXdr(processor);

	expect(exec).toHaveBeenCalledWith('processScpHistoryEntryXDR', [
		Buffer.from('xdr')
	]);
});

function newProcessor(
	category: Category,
	pool: HasherPool,
	categoryVerificationData: CategoryVerificationData,
	parsedHistorySink?: ParsedHistorySink
): CategoryXDRProcessor {
	const url = Url.create('https://history.example');
	if (url.isErr()) throw url.error;

	return new CategoryXDRProcessor(
		pool,
		url.value,
		category,
		categoryVerificationData,
		parsedHistorySink
	);
}

function createPool(
	exec: (method: string, args: readonly unknown[]) => Promise<unknown>
): HasherPool {
	return {
		terminated: false,
		workerpool: { exec }
	} as unknown as HasherPool;
}

function createVerificationData(): CategoryVerificationData {
	return {
		calculatedTxSetHashes: new Map(),
		expectedHashesPerLedger: new Map(),
		calculatedTxSetResultHashes: new Map(),
		calculatedLedgerHeaderHashes: new Map(),
		protocolVersions: new Map()
	};
}

async function writeXdr(processor: CategoryXDRProcessor): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			reject(error);
		};
		processor.once('error', onError);
		processor.write(Buffer.from('xdr'), (error: Error | null | undefined) => {
			if (error) {
				reject(error);
				return;
			}
			processor.off('error', onError);
			resolve();
		});
	});
}

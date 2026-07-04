import { Url } from 'http-helper';
import { Category } from '../../history-archive/Category.js';
import type { CategoryVerificationData } from '../CategoryScanner.js';
import { CategoryXDRProcessor } from '../CategoryXDRProcessor.js';
import type { HasherPool } from '../HasherPool.js';

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
	resolveExec({ ledger: 7, hash: 'tx-set-hash' });
	await writePromise;

	expect(processor.categoryVerificationData.calculatedTxSetHashes.get(7)).toBe(
		'tx-set-hash'
	);
});

it('should propagate workerpool errors through the write callback', async () => {
	const error = new Error('hash worker failed');
	const exec = jest.fn(async () => {
		throw error;
	});
	const processor = newProcessor(
		Category.transactions,
		createPool(exec),
		createVerificationData()
	);

	await expect(writeXdr(processor)).rejects.toBe(error);
});

function newProcessor(
	category: Category,
	pool: HasherPool,
	categoryVerificationData: CategoryVerificationData
): CategoryXDRProcessor {
	const url = Url.create('https://history.example');
	if (url.isErr()) throw url.error;

	return new CategoryXDRProcessor(
		pool,
		url.value,
		category,
		categoryVerificationData
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

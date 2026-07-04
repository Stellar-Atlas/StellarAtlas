import { Writable } from 'stream';
import { Category } from '../history-archive/Category.js';
import { LedgerHeaderHistoryEntryResult } from './hash-worker.js';
import { Url } from 'http-helper';
import { CategoryVerificationData } from './CategoryScanner.js';
import { HasherPool } from './HasherPool.js';

export class CategoryXDRProcessor extends Writable {
	constructor(
		public pool: HasherPool,
		public url: Url,
		public category: Category,
		public categoryVerificationData: CategoryVerificationData
	) {
		super();
	}

	_write(
		xdr: Buffer,
		_encoding: string,
		callback: (error?: Error | null) => void
	): void {
		void this.processXdr(xdr).then(
			() => callback(),
			(error: unknown) => callback(toError(error))
		);
	}

	private async processXdr(xdr: Buffer): Promise<void> {
		if (this.pool.terminated) {
			//previous stream could still be transmitting
			throw new Error('Workerpool terminated');
		}

		switch (this.category) {
			case Category.results:
				await this.processTransactionResult(xdr);
				return;
			case Category.transactions:
				await this.processTransaction(xdr);
				return;
			case Category.ledger:
				await this.processLedgerHeader(xdr);
				return;
			default:
				return;
		}
	}

	private async processTransactionResult(xdr: Buffer): Promise<void> {
		const hashMap = await this.performInPool<{
			ledger: number;
			hash: string;
		}>(xdr, 'processTransactionHistoryResultEntryXDR');
		this.categoryVerificationData.calculatedTxSetResultHashes.set(
			hashMap.ledger,
			hashMap.hash
		);
	}

	private async processTransaction(xdr: Buffer): Promise<void> {
		const hashMap = await this.performInPool<{
			ledger: number;
			hash: string;
		}>(xdr, 'processTransactionHistoryEntryXDR');
		this.categoryVerificationData.calculatedTxSetHashes.set(
			hashMap.ledger,
			hashMap.hash
		);
	}

	private async processLedgerHeader(xdr: Buffer): Promise<void> {
		const ledgerHeaderResult = await this.performInPool<LedgerHeaderHistoryEntryResult>(
			xdr,
			'processLedgerHeaderHistoryEntryXDR'
		);
		this.categoryVerificationData.expectedHashesPerLedger.set(
			ledgerHeaderResult.ledger,
			{
				txSetResultHash: ledgerHeaderResult.transactionResultsHash,
				txSetHash: ledgerHeaderResult.transactionsHash,
				previousLedgerHeaderHash:
					ledgerHeaderResult.previousLedgerHeaderHash,
				bucketListHash: ledgerHeaderResult.bucketListHash
			}
		);
		this.categoryVerificationData.calculatedLedgerHeaderHashes.set(
			ledgerHeaderResult.ledger,
			ledgerHeaderResult.ledgerHeaderHash
		);

		this.categoryVerificationData.protocolVersions.set(
			ledgerHeaderResult.ledger,
			ledgerHeaderResult.protocolVersion
		);
	}

	private async performInPool<Return>(
		data: Buffer,
		method:
			| 'processTransactionHistoryResultEntryXDR'
			| 'processTransactionHistoryEntryXDR'
			| 'processLedgerHeaderHistoryEntryXDR'
	): Promise<Return> {
		return (await this.pool.workerpool.exec(method, [data])) as Return;
	}
}

function toError(error: unknown): Error {
	if (error instanceof Error) return error;
	return new Error(String(error));
}

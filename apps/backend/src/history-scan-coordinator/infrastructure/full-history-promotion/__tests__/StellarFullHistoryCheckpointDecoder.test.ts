import { createHash } from 'node:crypto';
import type { FullHistoryCheckpointCandidate } from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import {
	fullHistoryLedgerSequence,
	FullHistoryHash
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { StellarFullHistoryCheckpointDecoder } from '../StellarFullHistoryCheckpointDecoder.js';
import {
	emptyTransactionResultSetHash,
	publicNetworkPassphrase,
	readClassicArchiveTransactionFixture,
	readFeeBumpEtlFixture,
	type RealTransactionFixture
} from './RealStellarXdrFixtures.js';

describe('StellarFullHistoryCheckpointDecoder', () => {
	const decoder = new StellarFullHistoryCheckpointDecoder();

	it('recomputes and decodes a real classic archive envelope/result pair', async () => {
		const fixture = readClassicArchiveTransactionFixture();
		const decoded = await decoder.decode(
			createCandidate(fixture, publicNetworkPassphrase),
			publicNetworkPassphrase
		);

		expect(decoded.ledgers).toHaveLength(64);
		expect(
			decoded.ledgers.find(
				(ledger) => ledger.ledgerSequence === fixture.ledgerSequence.toString()
			)
		).toMatchObject({ transactionCount: 1 });
		expect(decoded.transactions).toEqual([
			expect.objectContaining({
				envelopeType: 'tx-v0',
				feeBid: '100',
				ledgerSequence: '556808',
				operationCount: 1,
				sourceAccount:
					'GCNDNEWL4WBR7DHE3VOVCKVMBB67JMZV3LBXUHPOVEPABEIBVVP5KPIC',
				sourceAccountSequence: '2373085395156995',
				transactionIndex: 0
			})
		]);
		expect(decoded.transactions[0]!.transactionHash.toHex()).toBe(
			'06261feeb7a3f0e56883b4f585e61f787ce3436949fe6305e7ed676de69140a2'
		);
		expect(decoded.results).toEqual([
			expect.objectContaining({
				feeCharged: '100',
				ledgerSequence: '556808',
				operationResultCount: 1,
				resultCode: 0,
				successful: true,
				transactionIndex: 0
			})
		]);
	});

	it('decodes a real stellar-etl fee-bump pair using outer hash/fee and inner facts', async () => {
		const fixture = readFeeBumpEtlFixture();
		const decoded = await decoder.decode(
			createCandidate(fixture, publicNetworkPassphrase),
			publicNetworkPassphrase
		);

		expect(decoded.transactions).toEqual([
			expect.objectContaining({
				envelopeType: 'fee-bump',
				feeBid: '93750',
				ledgerSequence: '59699270',
				operationCount: 1,
				sourceAccount:
					'GA2DUR2ZXDJM6CYREPP45E6UPZZP2765YUC65FCBJRV3AIY7ZPFXEGL3',
				sourceAccountSequence: '241479047249629101'
			})
		]);
		expect(decoded.transactions[0]!.transactionHash.toHex()).toBe(
			'c08806d61690a168bbd0159bd6ece44a34b57ca15b36ff52f2d5668adcd85901'
		);
		expect(decoded.results).toEqual([
			expect.objectContaining({
				feeCharged: '55289',
				operationResultCount: 1,
				resultCode: 1,
				successful: true
			})
		]);
	});

	it('rejects a passphrase that cannot reproduce the observed envelope hash', async () => {
		const candidate = createCandidate(
			readClassicArchiveTransactionFixture(),
			'Test SDF Network ; September 2015'
		);
		await expect(
			decoder.decode(candidate, candidate.proof.networkPassphrase)
		).rejects.toMatchObject({ reason: 'envelope-hash-mismatch' });
	});

	it.each([
		[
			'ledger/index mismatch',
			(candidate: FullHistoryCheckpointCandidate) => ({
				...candidate,
				results: [{ ...candidate.results[0]!, transactionIndex: 1 }]
			})
		],
		[
			'category mismatch',
			(candidate: FullHistoryCheckpointCandidate) => ({
				...candidate,
				envelopes: [
					{
						...candidate.envelopes[0]!,
						transactionSetHash: hash('wrong-category')
					}
				]
			})
		],
		[
			'ledger gap',
			(candidate: FullHistoryCheckpointCandidate) => ({
				...candidate,
				ledgers: candidate.ledgers.slice(1)
			})
		]
	] as const)('rejects %s evidence', async (_label, mutate) => {
		const candidate = mutate(
			createCandidate(
				readClassicArchiveTransactionFixture(),
				publicNetworkPassphrase
			)
		);
		await expect(
			decoder.decode(candidate, publicNetworkPassphrase)
		).rejects.toBeInstanceOf(Error);
	});

	it('rejects a single XDR record before decoding when it exceeds its byte cap', async () => {
		const candidate = createCandidate(
			readClassicArchiveTransactionFixture(),
			publicNetworkPassphrase
		);
		const oversized = Buffer.alloc(1_048_577).toString('base64');
		const changed = {
			...candidate,
			envelopes: [{ ...candidate.envelopes[0]!, envelopeXdr: oversized }]
		};
		await expect(
			decoder.decode(changed, publicNetworkPassphrase)
		).rejects.toMatchObject({ reason: 'xdr-bound-exceeded' });
	});

	it('rejects a partially registered set even when envelope and result rows are both absent', async () => {
		const candidate = createCandidate(
			readClassicArchiveTransactionFixture(),
			publicNetworkPassphrase
		);
		await expect(
			decoder.decode(
				{ ...candidate, envelopes: [], results: [] },
				publicNetworkPassphrase
			)
		).rejects.toMatchObject({ reason: 'category-hash-mismatch' });
	});
});

function createCandidate(
	fixture: RealTransactionFixture,
	networkPassphrase: string
): FullHistoryCheckpointCandidate {
	const checkpointLedger =
		fixture.ledgerSequence - (fixture.ledgerSequence % 64) + 63;
	const firstLedger = checkpointLedger - 63;
	const ledgers = Array.from({ length: 64 }, (_, index) => {
		const sequence = firstLedger + index;
		return {
			bucketListHash: hash(`bucket:${sequence}`),
			closedAt: new Date(Date.UTC(2026, 6, 11, 0, 0, index)),
			ledgerHash: hash(`ledger:${sequence}`),
			ledgerSequence: fullHistoryLedgerSequence(BigInt(sequence)),
			previousLedgerHash: hash(`ledger:${sequence - 1}`),
			protocolVersion: 27,
			transactionResultHash:
				sequence === fixture.ledgerSequence
					? fixture.transactionResultHash
					: emptyTransactionResultSetHash(),
			transactionSetHash:
				sequence === fixture.ledgerSequence
					? fixture.transactionSetHash
					: hash(`transactions:${sequence}`)
		};
	});
	return {
		envelopes: [
			{
				envelopeXdr: fixture.envelopeXdr,
				ledgerSequence: fullHistoryLedgerSequence(
					BigInt(fixture.ledgerSequence)
				),
				transactionIndex: 0,
				transactionSetHash: fixture.transactionSetHash
			}
		],
		ledgers,
		proof: {
			archiveUrlIdentity: 'https://archive.example',
			checkpointLedger: fullHistoryLedgerSequence(BigInt(checkpointLedger)),
			evaluatedAt: new Date('2026-07-11T12:00:00.000Z'),
			id: 1,
			networkPassphrase,
			sources: {
				checkpointState: source(1),
				ledger: source(2),
				results: source(4),
				transactions: source(3)
			},
			version: 5
		},
		results: [
			{
				ledgerSequence: fullHistoryLedgerSequence(
					BigInt(fixture.ledgerSequence)
				),
				resultXdr: fixture.resultXdr,
				transactionHash: fixture.transactionHash,
				transactionIndex: 0,
				transactionResultHash: fixture.transactionResultHash
			}
		]
	};
}

function source(seed: number): {
	readonly contentDigest: FullHistoryHash;
	readonly remoteId: string;
} {
	return {
		contentDigest: hash(`source:${seed}`),
		remoteId: `00000000-0000-8000-8000-${seed.toString().padStart(12, '0')}`
	};
}

function hash(value: string): FullHistoryHash {
	return FullHistoryHash.fromBytes(createHash('sha256').update(value).digest());
}

import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { fullHistoryLedgerSequence } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../TypeOrmFullHistoryCanonicalRepository.js';
import {
	fullHistoryEntities,
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from './FullHistoryCanonicalFixture.js';

jest.setTimeout(60_000);

describe('FullHistoryCanonicalLedgerQuery', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmFullHistoryCanonicalRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: fullHistoryEntities,
			logging: false,
			synchronize: false,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await installFullHistoryCanonicalSchema(dataSource);
		repository = new TypeOrmFullHistoryCanonicalRepository(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('returns an ordered bounded range with each ledger exact batch proof', async () => {
		const networkPassphrase = 'Canonical ledger range network';
		const genesis = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 801,
			networkPassphrase
		});
		const regular = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 802,
			checkpointLedger: 127,
			networkPassphrase
		});
		await repository.writeCheckpoint(genesis);
		await repository.writeCheckpoint(regular);

		const result = await repository.findLedgerRange(networkPassphrase, {
			firstLedger: fullHistoryLedgerSequence('62'),
			lastLedger: fullHistoryLedgerSequence('65')
		});

		expect(result.records.map((ledger) => ledger.ledgerSequence)).toEqual([
			'62',
			'63',
			'64',
			'65'
		]);
		expect(result.records[0]).toMatchObject({
			evidence: {
				archiveUrlIdentity: genesis.archiveUrlIdentity,
				batchId: genesis.batchId,
				checkpointLedger: genesis.checkpointLedger,
				checkpointProofId: genesis.proofId,
				decoderVersion: genesis.decoderVersion,
				proofEvaluatedAt: genesis.proofEvaluatedAt,
				proofVersion: genesis.proofVersion
			},
			operationCount: 0
		});
		expect(
			result.records[0]!.evidence.ledgerSourceObject.contentDigest.toHex()
		).toBe(genesis.sources.ledger.contentDigest.toHex());
		expect(result.records[2]).toMatchObject({
			evidence: {
				archiveUrlIdentity: regular.archiveUrlIdentity,
				batchId: regular.batchId,
				checkpointLedger: regular.checkpointLedger,
				checkpointProofId: regular.proofId
			},
			operationCount: regular.transactions[0]!.operationCount,
			transactionCount: 1
		});
		expect(result.records[2]!.evidence.ledgerSourceObject).toEqual({
			contentDigest: regular.sources.ledger.contentDigest,
			objectRemoteId: regular.sources.ledger.remoteId
		});
	});

	it('rejects inverted and oversized ranges before querying Postgres', async () => {
		await expect(
			repository.findLedgerRange('Canonical ledger limit network', {
				firstLedger: fullHistoryLedgerSequence('2'),
				lastLedger: fullHistoryLedgerSequence('1')
			})
		).rejects.toThrow('firstLedger must not exceed lastLedger');
		await expect(
			repository.findLedgerRange('Canonical ledger limit network', {
				firstLedger: fullHistoryLedgerSequence('1'),
				lastLedger: fullHistoryLedgerSequence('101')
			})
		).rejects.toThrow('at most 100 ledgers');
	});
});

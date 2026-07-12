import { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	firstPublicNetworkScpCheckpoint,
	publicNetworkPassphrase
} from '../../../../domain/history-archive-object/HistoryArchiveObjectScpPolicy.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import { TypeOrmHistoryArchiveCheckpointProofRepository } from '../TypeOrmHistoryArchiveCheckpointProofRepository.js';
import { mock } from 'jest-mock-extended';
import type { HistoryArchiveCheckpointProofRepository } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import type { HistoryArchiveObjectEventRecorder } from '../../../../use-cases/record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { FailHistoryArchiveObject } from '../../../../use-cases/fail-history-archive-object/FailHistoryArchiveObject.js';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../../database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';

export const proofArchiveUrl = 'https://proof.example/archive';
export const proofBucketHash = 'a'.repeat(64);
export const proofCheckpointLedger = firstPublicNetworkScpCheckpoint;

export async function createProofDataSource(url: string): Promise<{
	readonly dataSource: DataSource;
	readonly repository: TypeOrmHistoryArchiveCheckpointProofRepository;
}> {
	const dataSource = new DataSource({
		dropSchema: true,
		entities: [HistoryArchiveCheckpointProof, HistoryArchiveObject],
		logging: false,
		synchronize: true,
		type: 'postgres',
		url
	});
	await dataSource.initialize();
	const queryRunner = dataSource.createQueryRunner();
	await new HistoryArchiveObjectHostThrottleMigration1784410000000().up(
		queryRunner
	);
	await new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
		queryRunner
	);
	await queryRunner.release();
	await createCanonicalFrontierTestSchema(dataSource);
	return {
		dataSource,
		repository: new TypeOrmHistoryArchiveCheckpointProofRepository(dataSource)
	};
}

export async function refreshAndLoadProof(
	dataSource: DataSource,
	repository: TypeOrmHistoryArchiveCheckpointProofRepository,
	targetCheckpointLedger = proofCheckpointLedger
): Promise<HistoryArchiveCheckpointProof | null> {
	await repository.refreshForArchiveCheckpoint({
		archiveUrlIdentity: proofArchiveUrl,
		checkpointLedger: targetCheckpointLedger
	});
	return await dataSource
		.getRepository(HistoryArchiveCheckpointProof)
		.findOneBy({
			archiveUrlIdentity: proofArchiveUrl,
			checkpointLedger: targetCheckpointLedger
		});
}

export async function deleteProofObject(
	dataSource: DataSource,
	objectType: string
): Promise<void> {
	await dataSource.query(
		'delete from history_archive_object_queue where "archiveUrlIdentity" = $1 and "objectType" = $2',
		[proofArchiveUrl, objectType]
	);
}

export async function mutateProofFacts(
	dataSource: DataSource,
	objectType: 'ledger' | 'transactions' | 'results',
	mutate: (
		facts: Array<Record<string, unknown>>
	) => Array<Record<string, unknown>>
): Promise<void> {
	const objectRepository = dataSource.getRepository(HistoryArchiveObject);
	const object = await objectRepository.findOneByOrFail({
		archiveUrlIdentity: proofArchiveUrl,
		checkpointLedger: proofCheckpointLedger,
		objectType
	});
	const factKey =
		`${objectType === 'ledger' ? 'ledger' : objectType}Category` as
			'ledgerCategory' | 'transactionsCategory' | 'resultsCategory';
	const category = object.verificationFacts?.[factKey];
	if (category === undefined) throw new Error(`Missing ${factKey} fixture`);
	object.verificationFacts = {
		...object.verificationFacts,
		[factKey]: { ...category, ledgers: mutate([...category.ledgers]) }
	};
	await objectRepository.save(object);
}

export async function exerciseFlakyProofRefresh(
	dataSource: DataSource,
	repository: TypeOrmHistoryArchiveCheckpointProofRepository
) {
	await refreshAndLoadProof(dataSource, repository);
	await dataSource.query(
		`update history_archive_object_queue
		 set status = 'scanning', attempts = 1
		 where "archiveUrlIdentity" = $1 and "objectType" = 'bucket'`,
		[proofArchiveUrl]
	);
	const failedObject = await dataSource
		.getRepository(HistoryArchiveObject)
		.findOneByOrFail({
			archiveUrlIdentity: proofArchiveUrl,
			objectType: 'bucket'
		});
	const objectRepository = new TypeOrmHistoryArchiveObjectRepository(
		dataSource.getRepository(HistoryArchiveObject)
	);
	const flakyProofRepository = mock<HistoryArchiveCheckpointProofRepository>();
	flakyProofRepository.refreshForObject
		.mockRejectedValueOnce(new Error('transient proof refresh failure'))
		.mockImplementation(async (object) => {
			await repository.refreshForObject(object);
		});
	const useCase = new FailHistoryArchiveObject(
		objectRepository,
		mock<HistoryArchiveObjectEventRecorder>(),
		flakyProofRepository
	);
	const failure = {
		claimAttempt: 1,
		errorMessage: 'Wrong bucket hash',
		errorType: 'bucket_verification_failed',
		failureChannel: 'archive_evidence',
		httpStatus: 200
	} as const;
	return {
		failedObject,
		failure,
		flakyProofRepository,
		objectRepository,
		useCase
	};
}

export async function saveDuplicateProofLedger(
	dataSource: DataSource
): Promise<void> {
	const repository = dataSource.getRepository(HistoryArchiveObject);
	const source = await repository.findOneByOrFail({
		archiveUrlIdentity: proofArchiveUrl,
		checkpointLedger: proofCheckpointLedger,
		objectType: 'ledger'
	});
	const duplicate = createProofObject(
		'ledger',
		proofCheckpointLedger,
		source.verificationFacts
	);
	duplicate.objectKey += ':duplicate';
	duplicate.objectUrl += ':duplicate';
	if (duplicate.verificationFacts?.ledgerCategory === undefined) {
		throw new Error('Expected duplicate ledger facts');
	}
	duplicate.verificationFacts = {
		...duplicate.verificationFacts,
		ledgerCategory: {
			...duplicate.verificationFacts.ledgerCategory,
			sourceUrl: duplicate.objectUrl
		}
	};
	await repository.save(duplicate);
}

export async function saveProofFixture(
	dataSource: DataSource,
	options: {
		readonly checkpointLedger?: number;
		readonly networkPassphrase?: string;
		readonly protocolVersion?: number | null;
	} = {}
): Promise<void> {
	const targetCheckpointLedger =
		options.checkpointLedger ?? proofCheckpointLedger;
	const genesisCheckpoint = targetCheckpointLedger === 63;
	const targetFirstLedger = genesisCheckpoint ? 1 : targetCheckpointLedger - 63;
	const expectedLedgerCount = genesisCheckpoint ? 63 : 64;
	const previousCheckpointLedger = targetCheckpointLedger - 64;
	const previousLedger = targetFirstLedger - 1;
	const protocolVersion =
		options.protocolVersion === undefined ? 22 : options.protocolVersion;
	const ledgerFacts = Array.from({ length: expectedLedgerCount }, (_, index) =>
		createLedgerFact(
			targetFirstLedger + index,
			targetCheckpointLedger,
			protocolVersion
		)
	);
	const checkpoint = createProofObject(
		'checkpoint-state',
		targetCheckpointLedger,
		{
			checkpointHistoryArchiveState: {
				observedAt: '2026-07-10T00:00:00.000Z',
				stellarHistory: {
					currentBuckets: [
						{
							curr: proofBucketHash,
							next: { state: 0 },
							snap: '0'.repeat(64)
						}
					],
					currentLedger: targetCheckpointLedger,
					networkPassphrase:
						options.networkPassphrase ?? publicNetworkPassphrase,
					server: 'stellar-core',
					version: 1
				},
				stellarHistoryUrl: sourceUrlFor(
					'checkpoint-state',
					targetCheckpointLedger
				)
			},
			checkpointHistoryArchiveStateFact: {
				bucketListHash: 'bucket-list-hash',
				checkpointLedger: targetCheckpointLedger,
				observedAt: '2026-07-10T00:00:00.000Z',
				stellarHistoryUrl: sourceUrlFor(
					'checkpoint-state',
					targetCheckpointLedger
				)
			}
		}
	);
	const bucket = new HistoryArchiveObject({
		archiveUrl: proofArchiveUrl,
		archiveUrlIdentity: proofArchiveUrl,
		bucketHash: proofBucketHash,
		objectKey: `bucket:${proofBucketHash}`,
		objectOrder: 50,
		objectType: 'bucket',
		objectUrl: `${proofArchiveUrl}/bucket-${proofBucketHash}.xdr.gz`,
		status: 'verified'
	});
	bucket.verificationFacts = {
		bucketObject: {
			expectedBucketHash: proofBucketHash,
			hashAlgorithm: 'sha256',
			matched: true,
			sourceUrl: bucket.objectUrl
		}
	};
	const objects = [
		checkpoint,
		createProofObject('ledger', targetCheckpointLedger, {
			ledgerCategory: { entryCount: expectedLedgerCount, ledgers: ledgerFacts }
		}),
		...(genesisCheckpoint
			? []
			: [
					createProofObject('ledger', previousCheckpointLedger, {
						ledgerCategory: {
							entryCount: 1,
							ledgers: [
								createLedgerFact(
									previousLedger,
									targetCheckpointLedger,
									protocolVersion
								)
							]
						}
					})
				]),
		createProofObject('transactions', targetCheckpointLedger, {
			transactionsCategory: {
				entryCount: expectedLedgerCount,
				ledgers: ledgerFacts.map((fact) => ({
					hash: fact.transactionSetHash,
					ledger: fact.ledger
				}))
			}
		}),
		createProofObject('results', targetCheckpointLedger, {
			resultsCategory: {
				entryCount: expectedLedgerCount,
				ledgers: ledgerFacts.map((fact) => ({
					hash: fact.transactionResultSetHash,
					ledger: fact.ledger
				}))
			}
		}),
		createProofObject('scp', targetCheckpointLedger, {
			scpCategory: { entryCount: 1 }
		}),
		bucket
	];
	const objectRepository = dataSource.getRepository(HistoryArchiveObject);
	await objectRepository.save(objects);
	await new TypeOrmHistoryArchiveObjectRepository(
		objectRepository
	).materializeCheckpointDependencies(checkpoint.remoteId);
}

export function createProofObject(
	objectType:
		'checkpoint-state' | 'ledger' | 'transactions' | 'results' | 'scp',
	ledger: number,
	verificationFacts: HistoryArchiveObject['verificationFacts']
): HistoryArchiveObject {
	const hex = ledger.toString(16).padStart(8, '0');
	const object = new HistoryArchiveObject({
		archiveUrl: proofArchiveUrl,
		archiveUrlIdentity: proofArchiveUrl,
		checkpointLedger: ledger,
		objectKey: `${objectType}:${hex}`,
		objectOrder: 10,
		objectType,
		objectUrl: sourceUrlFor(objectType, ledger),
		status: 'verified'
	});
	object.verificationFacts = withSourceUrl(
		objectType,
		object.objectUrl,
		verificationFacts
	);
	return object;
}

function sourceUrlFor(objectType: string, ledger: number): string {
	return `${proofArchiveUrl}/${objectType}-${ledger.toString(16).padStart(8, '0')}`;
}

function withSourceUrl(
	objectType: string,
	objectUrl: string,
	verificationFacts: HistoryArchiveObject['verificationFacts']
): HistoryArchiveObject['verificationFacts'] {
	if (verificationFacts === null) return null;
	if (objectType === 'ledger' && verificationFacts.ledgerCategory) {
		return {
			...verificationFacts,
			ledgerCategory: {
				...verificationFacts.ledgerCategory,
				sourceUrl: objectUrl
			}
		};
	}
	if (objectType === 'transactions' && verificationFacts.transactionsCategory) {
		return {
			...verificationFacts,
			transactionsCategory: {
				...verificationFacts.transactionsCategory,
				sourceUrl: objectUrl
			}
		};
	}
	if (objectType === 'results' && verificationFacts.resultsCategory) {
		return {
			...verificationFacts,
			resultsCategory: {
				...verificationFacts.resultsCategory,
				sourceUrl: objectUrl
			}
		};
	}
	if (objectType === 'scp' && verificationFacts.scpCategory) {
		return {
			...verificationFacts,
			scpCategory: { ...verificationFacts.scpCategory, sourceUrl: objectUrl }
		};
	}
	return verificationFacts;
}

export function createLedgerFact(
	ledger: number,
	targetCheckpointLedger: number,
	protocolVersion: number | null
) {
	return {
		bucketListHash:
			ledger === targetCheckpointLedger ? 'bucket-list-hash' : 'other',
		ledger,
		ledgerHeaderHash: `header-${ledger}`,
		previousLedgerHeaderHash: `header-${ledger - 1}`,
		protocolVersion,
		transactionResultSetHash: `result-${ledger}`,
		transactionSetHash: `transaction-${ledger}`
	};
}

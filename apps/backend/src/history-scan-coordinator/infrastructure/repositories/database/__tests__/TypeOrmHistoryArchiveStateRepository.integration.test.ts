import { setTimeout as delay } from 'node:timers/promises';
import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	HistoryArchiveStateSnapshot,
	type HistoryArchiveStateFailureInput
} from '../../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import { TypeOrmHistoryArchiveStateRepository } from '../TypeOrmHistoryArchiveStateRepository.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';

jest.setTimeout(60_000);

type FailureWrite = Omit<HistoryArchiveStateFailureInput, 'archiveUrlIdentity'>;

describe('TypeOrmHistoryArchiveStateRepository ordering', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveStateRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: [HistoryArchiveObject, HistoryArchiveStateSnapshot],
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		repository = createRepository(dataSource.manager);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('retains latest success and failure independently across late interleaving', async () => {
		const archiveUrl = 'https://interleaved-state.example/archive';
		await repository.saveAvailable(
			archiveUrl,
			createMetadata(archiveUrl, '2026-07-13T02:00:00.000Z', 200),
			'network-scan'
		);
		await repository.saveFailure(
			createFailure(archiveUrl, '2026-07-13T04:00:00.000Z', 'new failure', 503)
		);
		await repository.saveAvailable(
			archiveUrl,
			createMetadata(archiveUrl, '2026-07-13T03:00:00.000Z', 300),
			'history-scanner'
		);
		await repository.saveFailure(
			createFailure(archiveUrl, '2026-07-13T01:00:00.000Z', 'old failure', 404)
		);
		await repository.saveAvailable(
			archiveUrl,
			createMetadata(archiveUrl, '2026-07-13T01:30:00.000Z', 150),
			'backfill'
		);

		await expect(repository.findByUrl(archiveUrl)).resolves.toMatchObject({
			currentLedger: 300,
			errorMessage: null,
			latestFailureHttpStatus: 503,
			latestFailureMessage: 'new failure',
			latestFailureObservedAt: new Date('2026-07-13T04:00:00.000Z'),
			latestFailureSource: 'history-scanner',
			latestFailureType: 'new failure type',
			observedAt: new Date('2026-07-13T03:00:00.000Z'),
			server: 'stellar-core/300',
			source: 'history-scanner',
			status: 'available'
		});
	});

	it('does not regress either channel when an older transaction commits last', async () => {
		const archiveUrl = 'https://out-of-order-commit.example/archive';
		const lateRunner = dataSource.createQueryRunner();
		const newerRunner = dataSource.createQueryRunner();
		await lateRunner.connect();
		await newerRunner.connect();
		await lateRunner.startTransaction();
		await newerRunner.startTransaction();
		const lateRepository = createRepository(lateRunner.manager);
		const newerRepository = createRepository(newerRunner.manager);
		let lateWrite: Promise<void> | null = null;

		try {
			await newerRepository.saveAvailable(
				archiveUrl,
				createMetadata(archiveUrl, '2026-07-13T09:00:00.000Z', 900),
				'history-scanner'
			);
			await newerRepository.saveFailure(
				createFailure(
					archiveUrl,
					'2026-07-13T10:00:00.000Z',
					'newer transaction failure',
					502
				)
			);

			const lateBackendPid = await getBackendPid(lateRunner);
			lateWrite = lateRepository.saveAvailable(
				archiveUrl,
				createMetadata(archiveUrl, '2026-07-13T07:00:00.000Z', 700),
				'network-scan'
			);
			await waitForDatabaseLock(dataSource, lateBackendPid);
			await newerRunner.commitTransaction();
			await lateWrite;
			await lateRepository.saveFailure(
				createFailure(
					archiveUrl,
					'2026-07-13T08:00:00.000Z',
					'late transaction failure',
					504
				)
			);
			await lateRunner.commitTransaction();
		} finally {
			if (newerRunner.isTransactionActive) {
				await newerRunner.rollbackTransaction();
			}
			if (lateWrite !== null) await Promise.allSettled([lateWrite]);
			if (lateRunner.isTransactionActive)
				await lateRunner.rollbackTransaction();
			await newerRunner.release();
			await lateRunner.release();
		}

		await expect(repository.findByUrl(archiveUrl)).resolves.toMatchObject({
			currentLedger: 900,
			latestFailureHttpStatus: 502,
			latestFailureMessage: 'newer transaction failure',
			latestFailureObservedAt: new Date('2026-07-13T10:00:00.000Z'),
			observedAt: new Date('2026-07-13T09:00:00.000Z'),
			server: 'stellar-core/900',
			status: 'available'
		});
	});
});

function createRepository(
	manager: EntityManager
): TypeOrmHistoryArchiveStateRepository {
	return new TypeOrmHistoryArchiveStateRepository(
		manager.getRepository(HistoryArchiveStateSnapshot)
	);
}

function createMetadata(
	archiveUrl: string,
	observedAt: string,
	currentLedger: number
): ArchiveMetadataDTO {
	return {
		observedAt,
		stellarHistory: {
			currentBuckets: [],
			currentLedger,
			server: `stellar-core/${currentLedger}`,
			version: 1
		},
		stellarHistoryUrl: stateUrlFor(archiveUrl)
	};
}

function createFailure(
	archiveUrl: string,
	observedAt: string,
	message: string,
	httpStatus: number
): FailureWrite {
	return {
		archiveUrl,
		errorMessage: message,
		errorType: `${message} type`,
		httpStatus,
		observedAt: new Date(observedAt),
		source: 'history-scanner',
		stateUrl: stateUrlFor(archiveUrl),
		status: 'unreachable'
	};
}

function stateUrlFor(archiveUrl: string): string {
	return `${archiveUrl}/.well-known/stellar-history.json`;
}

async function getBackendPid(queryRunner: QueryRunner): Promise<number> {
	const rows = (await queryRunner.query(
		'select pg_backend_pid()::integer as pid'
	)) as readonly { readonly pid: number }[];
	const pid = rows[0]?.pid;
	if (!Number.isSafeInteger(pid))
		throw new Error('Missing PostgreSQL backend PID');
	return pid;
}

async function waitForDatabaseLock(
	dataSource: DataSource,
	backendPid: number
): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const rows = await dataSource.query<
			readonly { readonly waitEventType: string | null }[]
		>(
			`select wait_event_type as "waitEventType"
			 from pg_stat_activity where pid = $1`,
			[backendPid]
		);
		if (rows[0]?.waitEventType === 'Lock') return;
		await delay(10);
	}
	throw new Error('Late archive-state write did not wait on a database lock');
}

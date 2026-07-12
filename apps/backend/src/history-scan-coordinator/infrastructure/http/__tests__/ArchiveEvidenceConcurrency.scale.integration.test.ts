import express from 'express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import { HistoryArchiveCheckpointProof } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveStateSnapshot } from '../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveEvidenceRootSummaryMigration1784950000000 } from '../../database/migrations/1784950000000-HistoryArchiveEvidenceRootSummaryMigration.js';
import type {
	KnownArchiveEvidenceQuery,
	KnownArchiveEvidenceReadModel,
	KnownArchiveEvidenceRepository
} from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { TypeOrmKnownArchiveEvidenceRepository } from '../../repositories/database/TypeOrmKnownArchiveEvidenceRepository.js';
import { GetKnownArchiveEvidence } from '../../../use-cases/get-known-archive-evidence/GetKnownArchiveEvidence.js';
import { GetHistoryArchiveEvidence } from '../../../use-cases/get-history-archive-evidence/GetHistoryArchiveEvidence.js';
import { createArchiveEvidenceCursorCodec } from '../../../use-cases/get-known-archive-evidence/ArchiveEvidenceCursorCodec.js';
import { archiveEvidenceRouter } from '../ArchiveEvidenceRouter.js';
import { PublicArchiveEvidenceAdmission } from '../PublicArchiveEvidenceRequest.js';

jest.setTimeout(120_000);

describe('public archive evidence concurrency', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [
				HistoryArchiveCheckpointProof,
				HistoryArchiveObject,
				HistoryArchiveObjectEvent,
				HistoryArchiveStateSnapshot
			],
			logging: false,
			poolSize: 4,
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		const runner = dataSource.createQueryRunner();
		await new HistoryArchiveObjectHostThrottleMigration1784410000000().up(
			runner
		);
		await runner.release();
		await seedArchiveObjects(dataSource, 100_001);
		const summaryRunner = dataSource.createQueryRunner();
		await summaryRunner.connect();
		try {
			await new HistoryArchiveEvidenceRootSummaryMigration1784950000000().up(
				summaryRunner
			);
		} finally {
			await summaryRunner.release();
		}
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('bounds DB-using work across concurrent public requests', async () => {
		const repository = new TrackingEvidenceRepository(
			dataSource,
			new TypeOrmKnownArchiveEvidenceRepository(dataSource)
		);
		const getKnownEvidence = new GetKnownArchiveEvidence(
			repository,
			mock<ExceptionLogger>(),
			createArchiveEvidenceCursorCodec({
				encodedKeys: `scale:${Buffer.alloc(32, 5).toString('base64url')}`,
				nodeEnv: 'test'
			})
		);
		const app = express();
		app.use(
			'/v2/archive-scans',
			archiveEvidenceRouter({
				admission: new PublicArchiveEvidenceAdmission(4, 1_000),
				getHistoryArchiveEvidence: new GetHistoryArchiveEvidence(
					getKnownEvidence
				)
			})
		);

		const responses = await Promise.all(
			Array.from({ length: 24 }, () =>
				request(app).get(
					'/v2/archive-scans/https%3A%2F%2Fhistory.example.com/object-evidence'
				)
			)
		);
		const statuses = responses.map((response) => response.status);
		const poolTotalCount = requirePoolTotalCount(dataSource.driver);

		expect(
			statuses.filter((status) => status !== 200 && status !== 429)
		).toEqual([]);
		expect(statuses).toContain(200);
		expect(statuses).toContain(429);
		expect(repository.maxActive).toBeLessThanOrEqual(4);
		expect(poolTotalCount).toBeLessThanOrEqual(4);
	});
});

class TrackingEvidenceRepository implements KnownArchiveEvidenceRepository {
	private active = 0;
	maxActive = 0;

	constructor(
		private readonly dataSource: DataSource,
		private readonly delegate: KnownArchiveEvidenceRepository
	) {}

	async findEvidence(
		query: KnownArchiveEvidenceQuery
	): Promise<KnownArchiveEvidenceReadModel> {
		this.active++;
		this.maxActive = Math.max(this.maxActive, this.active);
		try {
			await this.dataSource.query('select pg_sleep(0.05)');
			return await this.delegate.findEvidence(query);
		} finally {
			this.active--;
		}
	}
}

async function seedArchiveObjects(
	dataSource: DataSource,
	count: number
): Promise<void> {
	await dataSource.query(
		`
			insert into history_archive_object_queue (
				"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
				"objectType", "objectKey", "objectOrder", "objectUrl", status
			)
			select (
				'00000000-0000-4000-8000-' || lpad(value::text, 12, '0')
			)::uuid, $1, $1, 'history.example.com', 'ledger',
			'ledger:' || lpad(value::text, 12, '0'), value,
			$1 || '/ledger/' || value::text, 'pending'
			from generate_series(1, $2::integer) value
		`,
		['https://history.example.com', count]
	);
}

function requirePoolTotalCount(value: unknown): number {
	if (!isRecord(value)) throw new Error('Expected a database driver');
	const master = value.master;
	if (!isRecord(master) || typeof master.totalCount !== 'number') {
		throw new Error('Expected a database connection pool');
	}
	return master.totalCount;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

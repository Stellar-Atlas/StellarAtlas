import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import {
	createObjectRepositoryDataSource,
	resetHistoryArchiveObjectQueue
} from './HistoryArchiveObjectRepositoryFixture.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

const consumerCount = 24;
const dueAt = new Date(Date.now() - 60_000);

jest.setTimeout(180_000);

describe('history archive object claim concurrency', () => {
	let dataSource: DataSource;
	let secondDataSource: DataSource;
	let postgres: DisposablePostgres;
	let primary: TypeOrmHistoryArchiveObjectRepository;
	let secondary: TypeOrmHistoryArchiveObjectRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource, repository: primary } =
			await createObjectRepositoryDataSource(postgres.url));
		secondDataSource = new DataSource({
			entities: [HistoryArchiveObject],
			extra: { max: consumerCount },
			logging: false,
			synchronize: false,
			type: 'postgres',
			url: postgres.url
		});
		await secondDataSource.initialize();
		secondary = new TypeOrmHistoryArchiveObjectRepository(
			secondDataSource.getRepository(HistoryArchiveObject)
		);
	});

	beforeEach(async () => {
		await resetHistoryArchiveObjectQueue(dataSource);
	});

	afterAll(async () => {
		if (secondDataSource?.isInitialized) await secondDataSource.destroy();
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('fills 24 balanced slots while reserving at most 12 for retries', async () => {
		await save(
			...Array.from({ length: consumerCount }, (_, index) => [
				root(index),
				checkpoint(index, 'pending'),
				checkpoint(index, 'failed')
			]).flat()
		);

		const claimed = claimsOnly(await claimBurst(consumerCount));
		const retryClaims = claimed.filter((object) => isRetry(object));

		expect(claimed).toHaveLength(consumerCount);
		expect(new Set(claimed.map((object) => object.remoteId)).size).toBe(
			consumerCount
		);
		expect(
			new Set(claimed.map((object) => object.archiveUrlIdentity)).size
		).toBe(consumerCount);
		expect(retryClaims.length).toBeGreaterThanOrEqual(6);
		expect(retryClaims.length).toBeLessThanOrEqual(12);
		await expectRetrySlotsToBeEven();
		await expectActiveCaps(consumerCount);
	});

	it('uses exactly the 12 even slots for a retry-only backlog', async () => {
		await save(
			...Array.from({ length: consumerCount }, (_, index) => [
				root(index),
				checkpoint(index, 'failed')
			]).flat()
		);

		const claimed = claimsOnly(await claimBurst(consumerCount));

		expect(claimed).toHaveLength(consumerCount / 2);
		expect(claimed.every((object) => isRetry(object))).toBe(true);
		await expectRetrySlotsToBeEven();
		await expectActiveCaps(consumerCount / 2);
	});

	it('fills all 24 slots from a pending-only backlog', async () => {
		await save(
			...Array.from({ length: consumerCount }, (_, index) => [
				root(index),
				checkpoint(index, 'pending')
			]).flat()
		);

		const claimed = claimsOnly(await claimBurst(consumerCount));
		expect(claimed).toHaveLength(consumerCount);
		expect(claimed.every((object) => !isRetry(object))).toBe(true);
		await expectActiveCaps(consumerCount);
	});

	it('fills 24 mixed slots with 12 pending and 12 retry claims', async () => {
		const pendingRoots = Array.from({ length: 12 }, (_, index) => [
			root(index),
			checkpoint(index, 'pending')
		]).flat();
		const failedRoots = Array.from({ length: 24 }, (_, offset) => {
			const index = offset + 12;
			return [root(index), checkpoint(index, 'failed')];
		}).flat();
		await save(...pendingRoots, ...failedRoots);

		const claimed = claimsOnly(await claimBurst(consumerCount));

		expect(claimed).toHaveLength(consumerCount);
		expect(claimed.filter((object) => isRetry(object))).toHaveLength(12);
		expect(claimed.filter((object) => !isRetry(object))).toHaveLength(12);
		await expectRetrySlotsToBeEven();
		await expectActiveCaps(consumerCount);
	});

	it('enforces one active claim per root across two data sources', async () => {
		await save(
			root(0),
			...Array.from({ length: consumerCount }, (_, ordinal) =>
				checkpoint(0, 'pending', ordinal)
			)
		);

		const claimed = claimsOnly(await claimBurst(consumerCount));

		expect(claimed).toHaveLength(1);
		await expectActiveCaps(1);
	});

	it('fills 24 slots without exceeding two claims per host', async () => {
		await save(
			...Array.from({ length: 12 }, (_, hostIndex) =>
				Array.from({ length: 3 }, (_, rootOffset) => {
					const index = hostIndex * 3 + rootOffset;
					return [
						root(index, hostIndex),
						checkpoint(index, 'pending', 0, hostIndex)
					];
				})
			).flat(2)
		);

		const claimed = claimsOnly(await claimBurst(consumerCount));

		expect(claimed).toHaveLength(consumerCount);
		await expectActiveCaps(consumerCount);
	});

	it('bounds normal-root wait while priority work remains replenished', async () => {
		const priorityRootCount = 24;
		const normalRootCount = 24;
		const objects = Array.from(
			{ length: priorityRootCount + normalRootCount },
			(_, index) => {
				const candidate = checkpoint(index, 'pending');
				candidate.executionReason =
					index < priorityRootCount
						? 'canonical-frontier-reserve'
						: 'planned-frontier';
				return [root(index), candidate];
			}
		).flat();
		await save(...objects);

		const claimedRoots = new Set<string>();
		for (let burst = 0; burst < 3; burst += 1) {
			const claims = claimsOnly(await claimBurst(consumerCount));
			claims.forEach((claim) => claimedRoots.add(claim.archiveUrlIdentity));
			await requeueActiveClaims();
		}

		const normalRoots = Array.from({ length: normalRootCount }, (_, offset) =>
			archiveUrlFor(priorityRootCount + offset, priorityRootCount + offset)
		);
		expect(normalRoots.every((rootUrl) => claimedRoots.has(rootUrl))).toBe(
			true
		);
	});

	it('settles contended claim bursts within the scanner request budget', async () => {
		const lockRunner = dataSource.createQueryRunner();
		await lockRunner.connect();
		await lockRunner.startTransaction();
		try {
			await lockRunner.query(`
				select pg_advisory_xact_lock(
					hashtextextended('history_archive_object_claim_gate', 104729)
				)
			`);
			const attempts = await Promise.all(
				Array.from({ length: consumerCount }, async () => {
					const startedAt = performance.now();
					const object = await secondary.claimNextObject(['checkpoint-state']);
					return {
						durationMs: performance.now() - startedAt,
						object
					};
				})
			);
			const durations = attempts
				.map(({ durationMs }) => durationMs)
				.sort((left, right) => left - right);
			const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? 0;

			expect(attempts.every(({ object }) => object === null)).toBe(true);
			expect(p95).toBeLessThan(500);
			expect(durations.at(-1) ?? 0).toBeLessThan(1_500);
		} finally {
			await lockRunner.rollbackTransaction();
			await lockRunner.release();
		}
	});

	async function claimBurst(
		count: number
	): Promise<readonly (HistoryArchiveObject | null)[]> {
		return await Promise.all(
			Array.from({ length: count }, (_, index) =>
				(index % 2 === 0 ? primary : secondary).claimNextObject([
					'checkpoint-state'
				])
			)
		);
	}

	async function expectActiveCaps(expectedTotal: number): Promise<void> {
		const rows = (await dataSource.query(`
			select "archiveUrlIdentity", "hostIdentity"
			from "history_archive_object_queue"
			where status = 'scanning'
		`)) as readonly ActiveIdentityRow[];
		expect(rows).toHaveLength(expectedTotal);
		expect(
			maxCount(rows.map((row) => row.archiveUrlIdentity))
		).toBeLessThanOrEqual(1);
		expect(maxCount(rows.map((row) => row.hostIdentity))).toBeLessThanOrEqual(
			2
		);
		expect(rows.length).toBeLessThanOrEqual(consumerCount);
	}

	async function expectRetrySlotsToBeEven(): Promise<void> {
		const rows = (await dataSource.query(`
			select slot.slot, object."objectKey"
			from "history_archive_object_claim_slot" slot
			join "history_archive_object_queue" object
				on object."remoteId" = slot."objectRemoteId"
			where object."objectKey" like '%:failed:%'
		`)) as readonly ClaimSlotRow[];
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((row) => row.slot % 2 === 0)).toBe(true);
	}

	async function save(...objects: HistoryArchiveObject[]): Promise<void> {
		await dataSource.getRepository(HistoryArchiveObject).save(objects);
	}

	async function requeueActiveClaims(): Promise<void> {
		await dataSource.transaction(async (manager) => {
			await manager.query(`
				update "history_archive_object_queue"
				set status = 'pending',
					"claimedAt" = null,
					"workerStage" = null,
					"updatedAt" = now()
				where status = 'scanning'
			`);
			await manager.query(`
				update "history_archive_object_claim_slot"
				set "objectRemoteId" = null,
					"claimedAt" = null,
					"updatedAt" = now()
				where "objectRemoteId" is not null
			`);
		});
	}
});

interface ActiveIdentityRow {
	readonly archiveUrlIdentity: string;
	readonly hostIdentity: string;
}

interface ClaimSlotRow {
	readonly objectKey: string;
	readonly slot: number;
}

function root(index: number, hostIndex = index): HistoryArchiveObject {
	const archiveUrl = archiveUrlFor(index, hostIndex);
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		hostIdentity: `claim-host-${hostIndex}.example`,
		objectKey: 'root',
		objectOrder: 0,
		objectType: 'history-archive-state',
		objectUrl: `${archiveUrl}/.well-known/stellar-history.json`,
		status: 'verified'
	});
}

function checkpoint(
	index: number,
	status: 'failed' | 'pending',
	ordinal = 0,
	hostIndex = index
): HistoryArchiveObject {
	const archiveUrl = archiveUrlFor(index, hostIndex);
	const object = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger: 1_000_063 - ordinal * 64,
		hostIdentity: `claim-host-${hostIndex}.example`,
		objectKey: `checkpoint-state:${status}:${index}:${ordinal}`,
		objectOrder: 10,
		objectType: 'checkpoint-state',
		objectUrl: `${archiveUrl}/history/${status}-${ordinal}.json`,
		status
	});
	object.executionReason = 'planned-frontier';
	if (status === 'failed') object.nextAttemptAt = dueAt;
	return object;
}

function archiveUrlFor(index: number, hostIndex: number): string {
	return `https://claim-host-${hostIndex}.example/archive-${index}`;
}

function claimsOnly(
	claims: readonly (HistoryArchiveObject | null)[]
): readonly HistoryArchiveObject[] {
	return claims.filter(
		(claim): claim is HistoryArchiveObject => claim !== null
	);
}

function isRetry(object: HistoryArchiveObject): boolean {
	return object.objectKey.includes(':failed:');
}

function maxCount(values: readonly string[]): number {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return Math.max(0, ...counts.values());
}

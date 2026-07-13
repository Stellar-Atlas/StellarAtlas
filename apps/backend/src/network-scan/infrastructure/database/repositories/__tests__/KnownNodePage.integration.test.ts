import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import type Kernel from '@core/infrastructure/Kernel.js';
import { TestUtils } from '@core/utilities/TestUtils.js';
import NodeDetails from '@network-scan/domain/node/NodeDetails.js';
import NodeQuorumSet from '@network-scan/domain/node/NodeQuorumSet.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import { createDummyNode } from '@network-scan/domain/node/__fixtures__/createDummyNode.js';
import { createDummyPublicKey } from '@network-scan/domain/node/__fixtures__/createDummyPublicKey.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { QuorumSet } from 'shared';
import { DataSource } from 'typeorm';

describe('TypeOrmNodeRepository.findKnownPage', () => {
	let dataSource: DataSource;
	let kernel: Kernel;
	let postgres: DisposablePostgres;
	let previousDatabaseTestUrl: string | undefined;
	let repository: NodeRepository;

	jest.setTimeout(120_000);

	beforeAll(async () => {
		previousDatabaseTestUrl = process.env.DATABASE_TEST_URL;
		postgres = await startDisposablePostgres();
		process.env.DATABASE_TEST_URL = postgres.url;
		const { default: KernelImplementation } =
			await import('@core/infrastructure/Kernel.js');
		kernel = await KernelImplementation.getInstance(new ConfigMock());
		dataSource = kernel.container.get(DataSource);
		repository = kernel.container.get<NodeRepository>(
			NETWORK_TYPES.NodeRepository
		);
	});

	afterEach(async () => {
		await TestUtils.resetDB(dataSource);
	});

	afterAll(async () => {
		if (kernel !== undefined) await kernel.close();
		if (previousDatabaseTestUrl === undefined) {
			delete process.env.DATABASE_TEST_URL;
		} else {
			process.env.DATABASE_TEST_URL = previousDatabaseTestUrl;
		}
		if (postgres !== undefined) await postgres.stop();
	});

	it('filters, counts, classifies, and paginates before node hydration', async () => {
		const startedAt = new Date('2020-01-01T00:00:00.000Z');
		const validator = createDummyNode('10.0.0.1', 11625, startedAt);
		validator.updateQuorumSet(
			NodeQuorumSet.create('validator-quorum', new QuorumSet(1, [], [])),
			startedAt
		);
		const listener = createDummyNode('10.0.0.2', 11625, startedAt);
		listener.updateDetails(
			NodeDetails.create({
				alias: null,
				historyUrl: null,
				host: 'needle-listener.example',
				name: 'Needle Listener'
			}),
			startedAt
		);
		const archived = createDummyNode('10.0.0.3', 11625, startedAt);
		archived.archive(new Date('2020-02-01T00:00:00.000Z'));
		await repository.save([validator, listener, archived], startedAt);

		const publicKeyOnly = createDummyPublicKey();
		await dataSource.query(
			`insert into "node" ("publicKeyValue", "dateDiscovered")
			 values ($1, $2)`,
			[publicKeyOnly.value, startedAt]
		);

		const expectedKeys = [
			validator.publicKey.value,
			listener.publicKey.value,
			archived.publicKey.value,
			publicKeyOnly.value
		].toSorted();
		const page = await repository.findKnownPage({
			limit: 2,
			offset: 1,
			organizationPublicKeys: [],
			query: '',
			scope: 'all-known'
		});

		expect(page.total).toBe(4);
		expect(page.scopeTotals).toEqual({
			'all-known': 4,
			archived: 1,
			'current-validator': 1,
			listener: 1,
			'public-key-only': 1
		});
		expect(page.items.map((item) => item.identity.publicKey)).toEqual(
			expectedKeys.slice(1, 3)
		);

		for (const [scope, expectedPublicKey] of [
			['current-validator', validator.publicKey.value],
			['listener', listener.publicKey.value],
			['archived', archived.publicKey.value],
			['public-key-only', publicKeyOnly.value]
		] as const) {
			const scoped = await repository.findKnownPage({
				limit: 10,
				offset: 0,
				organizationPublicKeys: [],
				query: '',
				scope
			});
			expect(scoped.total).toBe(1);
			expect(scoped.items.map((item) => item.identity.publicKey)).toEqual([
				expectedPublicKey
			]);
			expect(scoped.items[0]?.node === null).toBe(
				scope === 'public-key-only'
			);
		}

		const queried = await repository.findKnownPage({
			limit: 10,
			offset: 0,
			organizationPublicKeys: [],
			query: 'needle-listener',
			scope: 'all-known'
		});
		expect(queried.total).toBe(1);
		expect(queried.items[0]?.identity.publicKey).toBe(
			listener.publicKey.value
		);

		const organizationQueried = await repository.findKnownPage({
			limit: 10,
			offset: 0,
			organizationPublicKeys: [validator.publicKey.value],
			query: 'organization-match',
			scope: 'all-known'
		});
		expect(organizationQueried.total).toBe(1);
		expect(organizationQueried.items[0]?.identity.publicKey).toBe(
			validator.publicKey.value
		);
	});
});

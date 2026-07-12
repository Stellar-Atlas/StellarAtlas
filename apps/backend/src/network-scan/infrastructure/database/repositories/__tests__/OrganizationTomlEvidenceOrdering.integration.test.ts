import Organization from '@network-scan/domain/organization/Organization.js';
import OrganizationMeasurement from '@network-scan/domain/organization/OrganizationMeasurement.js';
import { createDummyOrganizationId } from '@network-scan/domain/organization/__fixtures__/createDummyOrganizationId.js';
import { TomlState } from '@network-scan/domain/organization/scan/TomlState.js';
import { createTomlObservation } from '../__fixtures__/OrganizationTomlIntegrationFixtures.js';
import { OrganizationTomlPostgresTestContext } from '../__fixtures__/OrganizationTomlPostgresTestContext.js';
import { saveOrganizationMeasurement } from '../OrganizationTomlEvidencePersistence.js';

describe('organization TOML provenance ordering PostgreSQL', () => {
	let context: OrganizationTomlPostgresTestContext;
	jest.setTimeout(120_000);

	beforeAll(async () => {
		context = await OrganizationTomlPostgresTestContext.start();
	});
	afterEach(async () => context.reset());
	afterAll(async () => context.stop());

	test('retains success and failure independently while deduplicating bodies', async () => {
		const firstSuccessAt = new Date('2026-07-10T10:00:00.000Z');
		const failureAt = new Date('2026-07-10T11:00:00.000Z');
		const latestSuccessAt = new Date('2026-07-10T12:00:00.000Z');
		const organization = Organization.create(
			createDummyOrganizationId(),
			'org.example',
			firstSuccessAt
		);
		organization.updateStellarTomlText('VERSION="2.0.0"', firstSuccessAt);
		organization.recordTomlAttempt(
			'success',
			TomlState.Ok,
			[],
			firstSuccessAt,
			'VERSION="2.0.0"'
		);
		await context.organizationRepository.save([organization], firstSuccessAt);
		organization.recordTomlAttempt(
			'failure',
			TomlState.ParsingError,
			[],
			failureAt
		);
		await context.organizationRepository.save([organization], failureAt);
		organization.recordTomlAttempt(
			'success',
			TomlState.Ok,
			[],
			latestSuccessAt,
			'VERSION="2.0.0"'
		);
		await context.organizationRepository.save([organization], latestSuccessAt);

		const [historical] = await context.measurementRepository.findTomlEvidenceAt(
			[organization.organizationId.value],
			failureAt
		);
		const [latest] = await context.measurementRepository.findTomlEvidenceAt(
			[organization.organizationId.value],
			latestSuccessAt
		);
		const [storage] = (await context.dataSource.query(`
			select
				(select count(*)::integer from "organization_toml_attempt") as attempts,
				(select count(*)::integer from "organization_toml_content") as contents
		`)) as Array<{ attempts: number; contents: number }>;

		expect(historical?.latestAttempt?.result).toBe('failure');
		expect(historical?.latestSuccess).toMatchObject({
			content: 'VERSION="2.0.0"',
			observedAt: firstSuccessAt
		});
		expect(latest).toMatchObject({
			latestAttempt: { observedAt: latestSuccessAt, result: 'success' },
			latestFailure: { observedAt: failureAt, result: 'failure' },
			latestSuccess: { observedAt: latestSuccessAt }
		});
		expect(storage).toEqual({ attempts: 3, contents: 1 });
	});

	test('makes concurrent retries for one durable run idempotent', async () => {
		const discoveredAt = new Date('2020-01-01T00:00:00.000Z');
		const observedAt = new Date('2020-01-02T00:00:00.000Z');
		const organization = await persistEmptyOrganization(discoveredAt);
		const measurement = new OrganizationMeasurement(
			observedAt,
			organization,
			'durable-run'
		);
		measurement.tomlAttemptAuthoritative = true;
		measurement.tomlAttemptContent = 'VERSION="2.0.0"';
		measurement.tomlFetchResult = 'success';
		measurement.tomlState = TomlState.Ok;

		await Promise.all([
			context.measurementRepository.save([measurement]),
			context.measurementRepository.save([measurement])
		]);

		const [counts] = (await context.dataSource.query(`
			select
				(select count(*)::integer from "organization_toml_attempt") as attempts,
				(select count(*)::integer from "organization_toml_content") as contents
		`)) as Array<{ attempts: number; contents: number }>;
		expect(counts).toEqual({ attempts: 1, contents: 1 });
	});

	test('does not move evidence backward when an older attempt commits later', async () => {
		const discoveredAt = new Date('2020-01-01T00:00:00.000Z');
		const successAt = new Date('2020-01-02T00:00:00.000Z');
		const olderFailureAt = new Date('2020-01-03T00:00:00.000Z');
		const newerFailureAt = new Date('2020-01-04T00:00:00.000Z');
		for (const [organization, from] of [
			[
				createTomlObservation(
					discoveredAt,
					successAt,
					'success',
					TomlState.Ok,
					'VERSION="2.0.0"'
				),
				discoveredAt
			],
			[
				createTomlObservation(
					discoveredAt,
					newerFailureAt,
					'failure',
					TomlState.NotFound
				),
				newerFailureAt
			],
			[
				createTomlObservation(
					discoveredAt,
					olderFailureAt,
					'failure',
					TomlState.ParsingError
				),
				olderFailureAt
			]
		] as const) {
			await context.organizationRepository.save([organization], from);
		}

		const [evidence] = await context.measurementRepository.findTomlEvidenceAt(
			[await persistedOrganizationId()],
			new Date('2020-01-05T00:00:00.000Z')
		);
		expect(evidence?.latestAttempt).toMatchObject({
			observedAt: newerFailureAt,
			state: TomlState.NotFound
		});
		expect(evidence?.latestSuccess).toMatchObject({
			content: 'VERSION="2.0.0"',
			observedAt: successAt
		});
	});

	test('rejects conflicting measurement fields for one durable run', async () => {
		const discoveredAt = new Date('2020-01-10T00:00:00.000Z');
		const observedAt = new Date('2020-01-11T00:00:00.000Z');
		const organization = await persistEmptyOrganization(discoveredAt);
		const first = failureMeasurement(
			organization,
			observedAt,
			'conflicting-run',
			TomlState.NotFound,
			1,
			false
		);
		const conflicting = failureMeasurement(
			organization,
			observedAt,
			'conflicting-run',
			TomlState.NotFound,
			2,
			true
		);

		await context.measurementRepository.save([first]);
		await expect(
			context.measurementRepository.save([conflicting])
		).rejects.toThrow('Conflicting organization measurement');

		const [stored] = (await context.dataSource.query(
			`select "isSubQuorumAvailable", "index"
			 from "organization_measurement" where "time" = $1`,
			[observedAt]
		)) as Array<Record<string, unknown>>;
		expect(stored).toMatchObject({ index: 1, isSubQuorumAvailable: false });
	});

	test('resolves concurrent equal-time attempts by provenance sequence', async () => {
		const discoveredAt = new Date('2020-02-01T00:00:00.000Z');
		const observedAt = new Date('2020-02-02T00:00:00.000Z');
		await persistEmptyOrganization(discoveredAt);
		const first = createTomlObservation(
			discoveredAt,
			observedAt,
			'failure',
			TomlState.ParsingError
		);
		const second = createTomlObservation(
			discoveredAt,
			observedAt,
			'failure',
			TomlState.NotFound
		);
		await Promise.all([
			context.organizationRepository.save([first], observedAt),
			context.organizationRepository.save([second], observedAt)
		]);

		const attempts = (await context.dataSource.query(`
			select attempt."sequence"::text as sequence, attempt.state
			from "organization_toml_attempt" attempt
			order by attempt."sequence" desc
		`)) as Array<{ sequence: string; state: TomlState }>;
		const [measurement] = (await context.dataSource.query(`
			select "tomlEvidenceSequence"::text as sequence, "tomlState" as state
			from "organization_measurement"
		`)) as Array<{ sequence: string; state: TomlState }>;
		const [snapshot] = (await context.dataSource.query(`
			select "latestAttemptSequence"::text as sequence,
				"latestAttemptState" as state from "organization_toml_snapshot"
		`)) as Array<{ sequence: string; state: TomlState }>;
		expect(attempts).toHaveLength(2);
		expect(measurement).toEqual(attempts[0]);
		expect(snapshot).toEqual(attempts[0]);
	});

	test('guards availability and TOML fields under inverted commit order', async () => {
		const discoveredAt = new Date('2020-02-10T00:00:00.000Z');
		const observedAt = new Date('2020-02-11T00:00:00.000Z');
		const organization = await persistEmptyOrganization(discoveredAt);
		const lower = failureMeasurement(
			organization,
			observedAt,
			'run-low',
			TomlState.ParsingError,
			1,
			false
		);
		const higher = failureMeasurement(
			organization,
			observedAt,
			'run-high',
			TomlState.NotFound,
			2,
			true
		);
		const lowerAllocated = deferred<void>();
		const releaseLower = deferred<void>();
		const lowerRunner = context.dataSource.createQueryRunner();
		const higherRunner = context.dataSource.createQueryRunner();
		await Promise.all([lowerRunner.connect(), higherRunner.connect()]);
		try {
			await lowerRunner.startTransaction();
			const lowerWrite = saveOrganizationMeasurement(
				lowerRunner.manager,
				organization,
				lower,
				{
					afterProvenanceAllocated: async () => {
						lowerAllocated.resolve();
						await releaseLower.promise;
					}
				}
			);
			await lowerAllocated.promise;
			await higherRunner.startTransaction();
			await saveOrganizationMeasurement(
				higherRunner.manager,
				organization,
				higher
			);
			await higherRunner.commitTransaction();
			releaseLower.resolve();
			await lowerWrite;
			await lowerRunner.commitTransaction();
		} finally {
			await Promise.all([lowerRunner.release(), higherRunner.release()]);
		}

		const [measurement] = (await context.dataSource.query(
			`select "isSubQuorumAvailable", "index", "tomlState",
				"tomlEvidenceSequence"::text as sequence
			 from "organization_measurement" where "time" = $1`,
			[observedAt]
		)) as Array<Record<string, unknown>>;
		expect(BigInt(higher.tomlEvidenceSequence)).toBeGreaterThan(
			BigInt(lower.tomlEvidenceSequence)
		);
		expect(measurement).toMatchObject({
			index: 2,
			isSubQuorumAvailable: true,
			sequence: higher.tomlEvidenceSequence,
			tomlState: TomlState.NotFound
		});
	});

	async function persistEmptyOrganization(at: Date): Promise<Organization> {
		const organization = Organization.create(
			createDummyOrganizationId(),
			'org.example',
			at
		);
		await context.organizationRepository.save([organization], at);
		const persisted = (
			await context.organizationRepository.findByHomeDomains(['org.example'])
		)[0];
		if (persisted === undefined)
			throw new Error('Missing persisted organization');
		return persisted;
	}

	async function persistedOrganizationId(): Promise<string> {
		const organization = (
			await context.organizationRepository.findByHomeDomains(['org.example'])
		)[0];
		if (organization === undefined) throw new Error('Missing organization');
		return organization.organizationId.value;
	}
});

function failureMeasurement(
	organization: Organization,
	observedAt: Date,
	runId: string,
	state: TomlState,
	index: number,
	available: boolean
): OrganizationMeasurement {
	const measurement = new OrganizationMeasurement(
		observedAt,
		organization,
		runId
	);
	measurement.index = index;
	measurement.isSubQuorumAvailable = available;
	measurement.tomlFetchResult = 'failure';
	measurement.tomlState = state;
	return measurement;
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

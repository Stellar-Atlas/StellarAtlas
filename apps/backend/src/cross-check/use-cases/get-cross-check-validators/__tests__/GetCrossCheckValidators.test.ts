import { mock, MockProxy } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { NodeV1 } from 'shared';
import { GetNodes } from '@network-scan/use-cases/get-nodes/GetNodes.js';
import { GetCrossCheckValidators } from '../GetCrossCheckValidators.js';

describe('GetCrossCheckValidators', () => {
	let getNodes: MockProxy<GetNodes>;
	let getCrossCheckValidators: GetCrossCheckValidators;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		getNodes = mock<GetNodes>();
		getCrossCheckValidators = new GetCrossCheckValidators(getNodes);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should map persisted validator-like nodes without external comparison', async () => {
		getNodes.execute.mockResolvedValue(
			ok([
				createNode({ publicKey: 'GA', isValidating: true }),
				createNode({ publicKey: 'GB', isValidator: true }),
				createNode({ publicKey: 'GC', activeInScp: true }),
				createNode({ publicKey: 'GD' })
			])
		);

		const result = await getCrossCheckValidators.execute({ limit: 2 });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toMatchObject({
			generatedAt: '2026-07-03T12:00:00.000Z',
			limit: 2,
			count: 2,
			totalEligibleCount: 3,
			probe: 'not_run',
			comparisonStatus: 'not_compared',
			evidenceSelection:
				'latest_network_snapshot_validator_or_validating_or_active_in_scp'
		});
		expect(result.value.validators).toHaveLength(2);
		expect(result.value.validators[0]).toMatchObject({
			publicKey: 'GA',
			comparisonStatus: 'not_compared',
			radarComparison: {
				sourceId: 'withobsrvr-radar',
				probe: 'not_run',
				comparisonStatus: 'not_compared'
			},
			stellarAtlas: {
				publicKey: 'GA',
				isValidating: true,
				isValidator: false,
				activeInScp: false,
				inclusionReasons: ['is_validating'],
				validatorEvidenceStatus: 'validating_observed'
			}
		});
		expect(
			result.value.validators[1].stellarAtlas.validatorEvidenceStatus
		).toBe('validator_identity_observed');
		expect(getNodes.execute).toHaveBeenCalledWith({});
	});

	it('should retain every inclusion reason when nodes match multiple predicates', async () => {
		getNodes.execute.mockResolvedValue(
			ok([
				createNode({
					publicKey: 'GA',
					activeInScp: true,
					isValidating: true,
					isValidator: true
				})
			])
		);

		const result = await getCrossCheckValidators.execute();

		expect(result._unsafeUnwrap().validators[0].stellarAtlas).toMatchObject({
			inclusionReasons: ['is_validator', 'is_validating', 'active_in_scp'],
			validatorEvidenceStatus: 'validating_observed'
		});
	});

	it('should default and cap limits', async () => {
		getNodes.execute.mockResolvedValue(ok([]));

		await getCrossCheckValidators.execute();
		const capped = await getCrossCheckValidators.execute({ limit: 200 });

		expect(capped._unsafeUnwrap().limit).toBe(100);
	});

	it('should propagate node read errors', async () => {
		const error = new Error('database unavailable');
		getNodes.execute.mockResolvedValue(err(error));

		const result = await getCrossCheckValidators.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
	});
});

function createNode(overrides: Partial<NodeV1>): NodeV1 {
	return {
		active: false,
		activeInScp: false,
		alias: null,
		connectivityError: false,
		dateDiscovered: '2026-07-03T00:00:00.000Z',
		dateUpdated: '2026-07-03T00:00:00.000Z',
		geoData: null,
		historyArchiveHasError: false,
		historyUrl: null,
		homeDomain: null,
		host: null,
		index: 0,
		ip: '127.0.0.1',
		isFullValidator: false,
		isValidating: false,
		isValidator: false,
		isp: null,
		lag: null,
		ledgerVersion: null,
		name: null,
		organizationId: null,
		overLoaded: false,
		overlayMinVersion: null,
		overlayVersion: null,
		port: 11625,
		publicKey: 'G'.padEnd(56, 'A'),
		quorumSet: null,
		quorumSetHashKey: null,
		statistics: {
			active24HoursPercentage: 0,
			active30DaysPercentage: 0,
			has24HourStats: false,
			has30DayStats: false,
			overLoaded24HoursPercentage: 0,
			overLoaded30DaysPercentage: 0,
			validating24HoursPercentage: 0,
			validating30DaysPercentage: 0
		},
		stellarCoreVersionBehind: false,
		versionStr: null,
		...overrides
	};
}

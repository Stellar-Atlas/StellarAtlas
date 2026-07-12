import type { Repository } from 'typeorm';
import OrganizationMeasurement from '@network-scan/domain/organization/OrganizationMeasurement.js';
import { TypeOrmOrganizationMeasurementRepository } from '../TypeOrmOrganizationMeasurementRepository.js';
import { TomlState } from '@network-scan/domain/organization/scan/TomlState.js';

describe('TypeOrmOrganizationMeasurementRepository TOML evidence', () => {
	it('maps latest attempt, success, and retained failure independently', async () => {
		const query = jest.fn().mockResolvedValue([
			{
				organizationId: 'org.example',
				latestAttemptAuthoritative: true,
				latestAttemptContent: 'VERSION="2.0.0"',
				latestAttemptObservedAt: new Date('2026-07-10T12:00:00.000Z'),
				latestAttemptRunId: 'success-run',
				latestAttemptSequence: '7',
				latestAttemptResult: 'success',
				latestAttemptState: TomlState.Ok,
				latestAttemptWarnings: [],
				latestSuccessObservedAt: new Date('2026-07-10T12:00:00.000Z'),
				latestSuccessSequence: '7',
				latestSuccessContent: 'VERSION="2.0.0"',
				latestSuccessWarnings: [],
				latestFailureContent: '<html>',
				latestFailureObservedAt: new Date('2026-07-10T11:00:00.000Z'),
				latestFailureRunId: 'failure-run',
				latestFailureSequence: '6',
				latestFailureState: TomlState.ParsingError,
				latestFailureWarnings: [],
				latestInsecureObservedAt: null
			}
		]);
		const repository = new TypeOrmOrganizationMeasurementRepository({
			manager: { query }
		} as unknown as Repository<OrganizationMeasurement>);
		const at = new Date('2026-07-10T13:00:00.000Z');

		const evidence = await repository.findTomlEvidenceAt(['org.example'], at);

		expect(evidence).toEqual([
			{
				organizationId: 'org.example',
				latestAttempt: {
					authoritative: true,
					content: 'VERSION="2.0.0"',
					observedAt: new Date('2026-07-10T12:00:00.000Z'),
					result: 'success',
					runId: 'success-run',
					sequence: '7',
					state: TomlState.Ok,
					warnings: []
				},
				latestSuccess: {
					content: 'VERSION="2.0.0"',
					observedAt: new Date('2026-07-10T12:00:00.000Z'),
					sequence: '7',
					warnings: []
				},
				latestFailure: {
					authoritative: false,
					content: '<html>',
					observedAt: new Date('2026-07-10T11:00:00.000Z'),
					result: 'failure',
					runId: 'failure-run',
					sequence: '6',
					state: TomlState.ParsingError,
					warnings: []
				},
				latestInsecureAttempt: null
			}
		]);
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining('candidate."observedAt" <= $1'),
			[at, ['org.example']]
		);
		expect(query.mock.calls[0]?.[0]).toContain(
			'candidate."observedAt" desc, candidate."sequence" desc'
		);
	});

	it('does not query persistence for an empty organization set', async () => {
		const query = jest.fn();
		const repository = new TypeOrmOrganizationMeasurementRepository({
			manager: { query }
		} as unknown as Repository<OrganizationMeasurement>);

		expect(await repository.findTomlEvidenceAt([], new Date())).toEqual([]);
		expect(query).not.toHaveBeenCalled();
	});
});

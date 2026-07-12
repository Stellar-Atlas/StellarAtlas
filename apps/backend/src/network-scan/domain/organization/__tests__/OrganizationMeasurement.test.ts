import Organization from '../Organization.js';
import OrganizationMeasurement from '../OrganizationMeasurement.js';
import { createDummyOrganizationId } from '../__fixtures__/createDummyOrganizationId.js';
import { TomlState } from '../scan/TomlState.js';

describe('OrganizationMeasurement TOML hydration', () => {
	it('normalizes nullable legacy provenance to unknown not-attempted evidence', () => {
		const organization = Organization.create(
			createDummyOrganizationId(),
			'org.example',
			new Date('2020-01-01T00:00:00.000Z')
		);
		const measurement = new OrganizationMeasurement(
			new Date('2020-01-02T00:00:00.000Z'),
			organization
		);
		Object.assign(measurement, {
			scanRunId: null,
			tomlEvidenceSequence: null,
			tomlFetchResult: null,
			tomlState: TomlState.Ok,
			tomlWarnings: null
		});

		expect(measurement.toTomlAttempt()).toBeNull();
		expect(measurement.tomlFetchResult).toBe('not_attempted');
		expect(measurement.tomlEvidenceSequence).toBe('0');
		expect(measurement.tomlState).toBe(TomlState.Unknown);
		expect(measurement.tomlWarnings).toEqual([]);
	});

	it('degrades attempted evidence without a durable run id instead of throwing', () => {
		const organization = Organization.create(
			createDummyOrganizationId(),
			'org.example',
			new Date('2020-01-01T00:00:00.000Z')
		);
		const measurement = new OrganizationMeasurement(
			new Date('2020-01-02T00:00:00.000Z'),
			organization
		);
		Object.assign(measurement, {
			scanRunId: null,
			tomlFetchResult: 'success',
			tomlState: TomlState.Ok
		});

		expect(measurement.toTomlAttempt()).toBeNull();
		expect(measurement.tomlFetchResult).toBe('not_attempted');
	});
});

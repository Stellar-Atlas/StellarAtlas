import type { EntityManager, Repository } from 'typeorm';
import Organization from '@network-scan/domain/organization/Organization.js';
import { createDummyOrganizationId } from '@network-scan/domain/organization/__fixtures__/createDummyOrganizationId.js';
import { TomlState } from '@network-scan/domain/organization/scan/TomlState.js';
import { TypeOrmOrganizationRepository } from '../TypeOrmOrganizationRepository.js';

describe('TypeOrmOrganizationRepository TOML evidence', () => {
	it('writes exact content and strict provenance guards', async () => {
		const observedAt = new Date('2026-07-10T12:00:00.000Z');
		const content = 'VERSION="2.0.0"';
		const runId = 'network-scan:2026-07-10T12:00:00.000Z';
		const organization = Organization.create(
			createDummyOrganizationId(),
			'org.example',
			observedAt
		);
		organization.updateStellarTomlText(content, observedAt);
		organization.recordTomlAttempt(
			'success',
			TomlState.Ok,
			[],
			observedAt,
			content,
			true,
			runId
		);

		let contentHash = '';
		const query = jest.fn().mockImplementation((sql: string, params = []) => {
			if (sql.includes('from "organization"')) return [{ id: 42 }];
			if (sql.includes('insert into "organization_toml_content"')) {
				contentHash = String(params[0]);
				return [{ content }];
			}
			if (sql.includes('insert into "organization_toml_attempt"')) {
				return [
					{
						authoritative: true,
						contentHash,
						observedAt,
						result: 'success',
						scanRunId: runId,
						sequence: '9',
						source: 'network_scan',
						state: TomlState.Ok,
						warnings: []
					}
				];
			}
			if (sql.includes('select "tomlEvidenceSequence"::text as "sequence"')) {
				return [
					{
						index: 0,
						isSubQuorumAvailable: false,
						scanRunId: runId,
						sequence: '9',
						tomlFetchResult: 'success',
						tomlState: TomlState.Ok,
						tomlWarnings: []
					}
				];
			}
			return [];
		});
		const entityManager = {
			query,
			save: jest.fn()
		} as unknown as EntityManager;
		const repository = new TypeOrmOrganizationRepository({
			manager: entityManager
		} as unknown as Repository<Organization>);

		await repository.saveOne(organization, observedAt, entityManager);

		const sql = query.mock.calls.map(([statement]) => statement).join('\n');
		expect(sql).toContain(
			'on conflict ("organizationId", "scanRunId") do nothing'
		);
		expect(sql).toMatch(
			/"organization_measurement"\."time",\s*"organization_measurement"\."tomlEvidenceSequence"\s*\) < \(excluded/
		);
		expect(sql).toMatch(
			/\("latestAttemptObservedAt", "latestAttemptSequence"\) <\s*\(\$2/
		);
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining('insert into "organization_toml_content"'),
			[contentHash, Buffer.byteLength(content, 'utf8'), content]
		);
	});
});

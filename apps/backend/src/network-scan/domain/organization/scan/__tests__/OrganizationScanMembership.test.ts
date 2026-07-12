import { Snapshot } from '@core/domain/Snapshot.js';
import { NodeScan } from '@network-scan/domain/node/scan/NodeScan.js';
import Organization from '../../Organization.js';
import { OrganizationId } from '../../OrganizationId.js';
import { OrganizationValidators } from '../../OrganizationValidators.js';
import { OrganizationScan } from '../OrganizationScan.js';
import type { OrganizationTomlInfo } from '../OrganizationTomlInfo.js';
import { TomlState } from '../TomlState.js';
import { InvalidValidatorPublicKeyError } from '../errors/InvalidValidatorPublicKeyError.js';
import { createValidValidatorNode } from './createValidValidatorNode.js';

describe('OrganizationScan validator membership', () => {
	const scanTime = new Date('2020-01-02T00:00:00.000Z');

	it('preserves membership and organization activity during an incomplete crawl', () => {
		const node = createValidator('domain.com');
		const organization = createOrganization(node);
		const scan = new OrganizationScan(scanTime, [organization]);

		const result = scan.updateWithTomlInfoCollection(
			new Map(),
			new NodeScan(scanTime, [])
		);

		expect(result.isOk()).toBe(true);
		expect(organization.validators.value).toEqual([node.publicKey]);
		expect(scan.archiveOrganizationsWithNoActiveValidators()).toEqual([]);
		expect(organization.snapshotEndDate).toEqual(Snapshot.MAX_DATE);
	});

	it('removes and archives membership after an observed home-domain change', () => {
		const node = createValidator('domain.com');
		const organization = createOrganization(node);
		node.updateHomeDomain('other.example', scanTime);
		const scan = new OrganizationScan(scanTime, [organization]);

		const result = scan.updateWithTomlInfoCollection(
			new Map(),
			new NodeScan(scanTime, [node])
		);

		expect(result.isOk()).toBe(true);
		expect(organization.validators.value).toEqual([]);
		expect(scan.archiveOrganizationsWithNoActiveValidators()).toEqual([
			organization
		]);
		expect(organization.snapshotEndDate).toEqual(scanTime);
	});

	it('preserves membership when any claimed validator fails StrKey validation', () => {
		const node = createValidator('domain.com');
		const organization = createOrganization(node);
		organization.updateStellarTomlText('VERSION="2.0.0"', scanTime);
		const malformed = `${node.publicKey.value.slice(0, -1)}${
			node.publicKey.value.endsWith('A') ? 'B' : 'A'
		}`;
		const tomlInfo: OrganizationTomlInfo = {
			authoritative: true,
			dba: null,
			description: null,
			fetchResult: 'success',
			github: null,
			horizonUrl: null,
			keybase: null,
			name: 'untrusted replacement',
			officialEmail: null,
			phoneNumber: null,
			physicalAddress: null,
			state: TomlState.Ok,
			stellarTomlText: 'VERSION="2.0.0"\nORG_NAME="unsafe"',
			twitter: null,
			url: null,
			validators: [node.publicKey.value, malformed],
			validatorSetValid: true,
			warnings: []
		};
		const scan = new OrganizationScan(scanTime, [organization]);

		const result = scan.updateWithTomlInfoCollection(
			new Map([['domain.com', tomlInfo]]),
			new NodeScan(scanTime, [node])
		);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value[0]?.error).toBeInstanceOf(
			InvalidValidatorPublicKeyError
		);
		expect(organization.validators.value).toEqual([node.publicKey]);
		expect(organization.stellarTomlText).toBe('VERSION="2.0.0"');
		expect(organization.name).toBeNull();
		expect(scan.archiveOrganizationsWithNoActiveValidators()).toEqual([]);
	});

	function createValidator(homeDomain: string) {
		const node = createValidValidatorNode(scanTime);
		node.updateHomeDomain(homeDomain, scanTime);
		return node;
	}

	function createOrganization(
		node: ReturnType<typeof createValidator>
	): Organization {
		const id = OrganizationId.create('domain.com');
		if (id.isErr()) throw id.error;
		const organization = Organization.create(
			id.value,
			'domain.com',
			new Date('2020-01-01T00:00:00.000Z')
		);
		organization.updateValidators(
			new OrganizationValidators([node.publicKey]),
			scanTime
		);
		return organization;
	}
});

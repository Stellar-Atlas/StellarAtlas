import { OrganizationScan } from '../OrganizationScan.js';
import { NodeScan } from '@network-scan/domain/node/scan/NodeScan.js';
import Organization from '../../Organization.js';
import { OrganizationId } from '../../OrganizationId.js';
import { OrganizationTomlInfo } from '../OrganizationTomlInfo.js';
import { OrganizationValidators } from '../../OrganizationValidators.js';
import { OrganizationContactInformation } from '../../OrganizationContactInformation.js';
import Node from '@network-scan/domain/node/Node.js';
import NodeMeasurement from '@network-scan/domain/node/NodeMeasurement.js';
import { ValidatorNotSEP20LinkedError } from '../errors/ValidatorNotSEP20LinkedError.js';
import { WrongNodeScanForOrganizationScan } from '../errors/WrongNodeScanForOrganizationScan.js';
import { TomlWithoutValidatorsError } from '../errors/TomlWithoutValidatorsError.js';
import { TomlState } from '../TomlState.js';
import { InvalidTomlStateError } from '../errors/InvalidTomlStateError.js';
import {
	createValidPublicKeyString,
	createValidValidatorNode
} from './createValidValidatorNode.js';

describe('OrganizationScan', () => {
	describe('updateWithTomlInfo', () => {
		it('should update existing organization', () => {
			const scanTime = new Date('2020-01-02');
			const nodeScan = createNodeScan(scanTime);
			const organizationScan = createOrganizationScan(scanTime);
			const tomlInfo = createTomlInfo(nodeScan);
			const result = organizationScan.updateWithTomlInfoCollection(
				new Map([['domain.com', tomlInfo]]),
				nodeScan
			);
			expect(result.isOk()).toBe(true);
			if (result.isErr()) throw result.error;
			expect(result.value).toHaveLength(0);
			expect(organizationScan.organizations[0].stellarTomlText).toBe(
				tomlInfo.stellarTomlText
			);
			assertOrganization(
				organizationScan.organizations[0],
				tomlInfo,
				nodeScan.nodes[0],
				scanTime
			);
		});

		it('should return invalid toml info when validator has wrong or missing home-domain', function () {
			const scanTime = new Date('2020-01-02');
			const nodeScan = createNodeScan(scanTime, 'wrong.com');
			nodeScan.nodes[0].updateHomeDomain('wrong.com', scanTime);
			const organizationScan = createOrganizationScan(scanTime);
			const tomlInfo = createTomlInfo(nodeScan);
			const result = organizationScan.updateWithTomlInfoCollection(
				new Map([['domain.com', tomlInfo]]),
				nodeScan
			);
			expect(result.isOk()).toBe(true);
			if (result.isErr()) throw result.error;
			expect(result.value).toHaveLength(1);
			expect(result.value[0].homeDomain).toBe('domain.com');
			expect(result.value[0].error).toBeInstanceOf(
				ValidatorNotSEP20LinkedError
			);
		});

		it('should return invalid toml info when there are no validators defined', function () {
			const scanTime = new Date('2020-01-02');
			const nodeScan = createNodeScan(scanTime, 'domain.com');
			const organizationScan = createOrganizationScan(scanTime);
			const tomlInfo = createTomlInfo(nodeScan);
			tomlInfo.validators = [];
			const result = organizationScan.updateWithTomlInfoCollection(
				new Map([['domain.com', tomlInfo]]),
				nodeScan
			);
			expect(result.isOk()).toBe(true);
			if (result.isErr()) throw result.error;
			expect(result.value).toHaveLength(1);
			expect(result.value[0].homeDomain).toBe('domain.com');
			expect(result.value[0].error).toBeInstanceOf(TomlWithoutValidatorsError);
		});

		it('should return invalid toml state when toml state is not ok', function () {
			const scanTime = new Date('2020-01-02');
			const nodeScan = createNodeScan(scanTime, 'domain.com');
			const organizationScan = createOrganizationScan(scanTime);
			const tomlInfo: OrganizationTomlInfo = {
				...createTomlInfo(nodeScan),
				authoritative: false,
				fetchResult: 'failure',
				state: TomlState.UnspecifiedError,
				stellarTomlText: null
			};
			const result = organizationScan.updateWithTomlInfoCollection(
				new Map([['domain.com', tomlInfo]]),
				nodeScan
			);
			expect(result.isOk()).toBe(true);
			if (result.isErr()) throw result.error;
			expect(result.value).toHaveLength(1);
			expect(result.value[0].homeDomain).toBe('domain.com');
			expect(result.value[0].error).toBeInstanceOf(InvalidTomlStateError);
		});

		it('keeps last-known-good TOML facts after a failed attempt', () => {
			const previousSuccessAt = new Date('2020-01-02');
			const scanTime = new Date('2020-01-03');
			const organization = createOrganization('domain.com');
			const previousNodeScan = createNodeScan(previousSuccessAt);
			const previousToml = createTomlInfo(previousNodeScan);
			const previousScan = new OrganizationScan(previousSuccessAt, [
				organization
			]);
			const previousResult = previousScan.updateWithTomlInfoCollection(
				new Map([['domain.com', previousToml]]),
				previousNodeScan
			);
			expect(previousResult.isOk()).toBe(true);

			const organizationScan = new OrganizationScan(scanTime, [organization]);
			const nodeScan = createNodeScan(scanTime);
			const failedToml: OrganizationTomlInfo = {
				...createTomlInfo(nodeScan),
				authoritative: false,
				fetchResult: 'failure',
				state: TomlState.ParsingError,
				stellarTomlText: null
			};

			const result = organizationScan.updateWithTomlInfoCollection(
				new Map([['domain.com', failedToml]]),
				nodeScan
			);

			expect(result.isOk()).toBe(true);
			expect(organization.stellarTomlText).toBe(previousToml.stellarTomlText);
			assertOrganization(
				organization,
				previousToml,
				previousNodeScan.nodes[0],
				previousSuccessAt
			);
			expect(organization.latestMeasurement()?.toTomlAttempt()).toEqual({
				authoritative: false,
				content: null,
				observedAt: scanTime,
				result: 'failure',
				runId: organizationScan.runId,
				state: TomlState.ParsingError,
				warnings: []
			});
		});

		it('should not update organizations if nodeScan has different time', () => {
			const time = new Date('2020-01-01');
			const nodeScanTime = new Date('2020-01-02');
			const nodeScan = new NodeScan(nodeScanTime, []);
			const organizationScan = new OrganizationScan(time, []);
			const result = organizationScan.updateWithTomlInfoCollection(
				new Map(),
				nodeScan
			);
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error).toBeInstanceOf(WrongNodeScanForOrganizationScan);
		});

		it('should add missing organizations', () => {
			const scanTime = new Date('2020-01-02');
			const nodeScan = createNodeScan(scanTime, 'domain2.com');
			const organizationScan = createOrganizationScan(scanTime);
			const tomlInfo = createTomlInfo(nodeScan);
			const result = organizationScan.updateWithTomlInfoCollection(
				new Map([['domain2.com', tomlInfo]]),
				nodeScan
			);
			expect(result.isOk()).toBe(true);
			if (result.isErr()) throw result.error;
			expect(result.value).toHaveLength(0);
			expect(organizationScan.organizations).toHaveLength(2);
			assertOrganization(
				organizationScan.organizations[1],
				tomlInfo,
				nodeScan.nodes[0],
				scanTime
			);
		});

		it('should update validators in existing organizations with missing toml file', () => {
			const scanTime = new Date('2020-01-02');
			const nodeScan = createNodeScan(scanTime);
			const organizationScan = createOrganizationScan(scanTime, 'domain.com');
			organizationScan.organizations[0].updateValidators(
				new OrganizationValidators([nodeScan.nodes[0].publicKey]),
				scanTime
			);

			nodeScan.nodes[0].updateHomeDomain('domain2.com', scanTime);
			const result = organizationScan.updateWithTomlInfoCollection(
				new Map(),
				nodeScan
			);
			expect(result.isOk()).toBe(true);
			if (result.isErr()) throw result.error;
			expect(result.value).toHaveLength(0);
			expect(organizationScan.organizations).toHaveLength(1);
			expect(organizationScan.organizations[0].validators.value).toHaveLength(
				0
			);
		});

		it('should un-archive archived organizations even if there are no changes to toml file', () => {
			const archivedOrganization = createOrganization('domain.com');
			archivedOrganization.archive(new Date('2020-01-01'));

			const scanTime = new Date('2020-01-02');
			const nodeScan = createNodeScan(scanTime);
			const organizationScan = new OrganizationScan(scanTime, []);
			const tomlInfo = createOrganizationTomlInfoWithNullValues();
			const result = organizationScan.updateWithTomlInfoCollection(
				new Map([['domain.com', tomlInfo]]),
				nodeScan,
				[archivedOrganization]
			);
			expect(result.isOk()).toBe(true);
			expect(organizationScan.organizations).toHaveLength(1);
			expect(organizationScan.organizations[0].snapshotStartDate).toEqual(
				scanTime
			);
		});

		it('should un-archive archived organization and update', function () {
			const archivedOrganization = createOrganization('domain.com');
			archivedOrganization.archive(new Date('2020-01-01'));

			const scanTime = new Date('2020-01-02');
			const nodeScan = createNodeScan(scanTime);
			const organizationScan = new OrganizationScan(scanTime, []);
			const tomlInfo = createTomlInfo(nodeScan);
			const result = organizationScan.updateWithTomlInfoCollection(
				new Map([['domain.com', tomlInfo]]),
				nodeScan,
				[archivedOrganization]
			);
			expect(result.isOk()).toBe(true);
			expect(organizationScan.organizations).toHaveLength(1);
			expect(organizationScan.organizations[0].snapshotStartDate).toEqual(
				scanTime
			);

			assertOrganization(
				organizationScan.organizations[0],
				tomlInfo,
				nodeScan.nodes[0],
				scanTime
			);
		});

		describe('TomlState update in Organization', () => {
			it('should update toml state to Ok when toml is valid', () => {
				const organizationScan = createOrganizationScan(new Date('2020-01-01'));
				const nodeScan = createNodeScan(new Date('2020-01-01'));
				const tomlInfo = createTomlInfo(nodeScan);
				const result = organizationScan.updateWithTomlInfoCollection(
					new Map([['domain.com', tomlInfo]]),
					nodeScan
				);
				expect(result.isOk()).toBe(true);
				if (result.isErr()) throw result.error;
				expect(result.value).toHaveLength(0);
				expect(
					organizationScan.organizations[0].latestMeasurement()?.tomlState
				).toBe(TomlState.Ok);
			});

			it('should preserve TOML warning evidence when toml is valid', () => {
				const organizationScan = createOrganizationScan(new Date('2020-01-01'));
				const nodeScan = createNodeScan(new Date('2020-01-01'));
				const tomlInfo = createTomlInfo(nodeScan);
				tomlInfo.warnings = ['TlsCertificateVerificationDisabled'];

				const result = organizationScan.updateWithTomlInfoCollection(
					new Map([['domain.com', tomlInfo]]),
					nodeScan
				);

				expect(result.isOk()).toBe(true);
				if (result.isErr()) throw result.error;
				const measurement =
					organizationScan.organizations[0].latestMeasurement();
				expect(measurement?.tomlState).toBe(TomlState.Ok);
				expect(measurement?.tomlWarnings).toEqual([
					'TlsCertificateVerificationDisabled'
				]);
				expect(measurement?.toTomlAttempt()?.authoritative).toBe(false);
				expect(organizationScan.organizations[0].stellarTomlText).toBeNull();
				expect(organizationScan.organizations[0].name).toBeNull();
			});

			it('should update toml state to UnspecifiedError when toml is invalid', () => {
				const organizationScan = createOrganizationScan(new Date('2020-01-01'));
				const nodeScan = createNodeScan(new Date('2020-01-01'));
				const tomlInfo = createTomlInfo(nodeScan);
				tomlInfo.state = TomlState.UnspecifiedError;
				const result = organizationScan.updateWithTomlInfoCollection(
					new Map([['domain.com', tomlInfo]]),
					nodeScan
				);
				expect(result.isOk()).toBe(true);
				if (result.isErr()) throw result.error;
				expect(result.value).toHaveLength(1);
				expect(
					organizationScan.organizations[0].latestMeasurement()?.tomlState
				).toBe(TomlState.UnspecifiedError);
			});

			it('should update toml state to ValidatorNotSEP20LinkedError', () => {
				const organizationScan = createOrganizationScan(new Date('2020-01-01'));
				const nodeScan = createNodeScan(new Date('2020-01-01'));
				nodeScan.nodes[0].updateHomeDomain(
					'domain2.com',
					new Date('2020-01-01')
				);
				const tomlInfo = createTomlInfo(nodeScan);
				const result = organizationScan.updateWithTomlInfoCollection(
					new Map([['domain.com', tomlInfo]]),
					nodeScan
				);
				expect(result.isOk()).toBe(true);
				if (result.isErr()) throw result.error;
				expect(result.value).toHaveLength(1);
				expect(
					organizationScan.organizations[0].latestMeasurement()?.tomlState
				).toBe(TomlState.ValidatorNotSEP20Linked);
			});
		});

		it('should update toml state to EmptyValidatorsField', function () {
			const organizationScan = createOrganizationScan(new Date('2020-01-01'));
			const nodeScan = createNodeScan(new Date('2020-01-01'));
			const tomlInfo = createTomlInfo(nodeScan);
			tomlInfo.validators = [];
			const result = organizationScan.updateWithTomlInfoCollection(
				new Map([['domain.com', tomlInfo]]),
				nodeScan
			);
			expect(result.isOk()).toBe(true);
			if (result.isErr()) throw result.error;
			expect(result.value).toHaveLength(1);
			expect(
				organizationScan.organizations[0].latestMeasurement()?.tomlState
			).toBe(TomlState.EmptyValidatorsField);
		});

		function createOrganizationTomlInfoWithNullValues(): OrganizationTomlInfo {
			return {
				authoritative: true,
				fetchResult: 'success',
				state: TomlState.Ok,
				warnings: [],
				stellarTomlText: 'VERSION="2.0.0"',
				horizonUrl: null,
				url: null,
				name: null,
				keybase: null,
				dba: null,
				github: null,
				description: null,
				officialEmail: null,
				physicalAddress: null,
				phoneNumber: null,
				twitter: null,
				validators: [createValidPublicKeyString()],
				validatorSetValid: true
			};
		}

		function createTomlInfo(nodeScan: NodeScan) {
			const tomlInfo: OrganizationTomlInfo = {
				authoritative: true,
				fetchResult: 'success',
				state: TomlState.Ok,
				warnings: [],
				stellarTomlText: 'VERSION="2.0.0"',
				horizonUrl: 'https://horizon.stellar.org',
				url: 'https://stellar.org',
				name: 'Stellar',
				keybase: 'keybase',
				dba: 'dba',
				github: 'stellar',
				description: 'description',
				officialEmail: 'email',
				physicalAddress: 'address',
				phoneNumber: 'phone',
				twitter: 'twitter',
				validators: [nodeScan.nodes[0].publicKey.value],
				validatorSetValid: true
			};
			return tomlInfo;
		}

		function assertOrganization(
			organization: Organization,
			tomlInfo: OrganizationTomlInfo,
			node: Node,
			scanTime: Date
		) {
			expect(organization.name).toBe(tomlInfo.name);
			expect(organization.url).toBe(tomlInfo.url);
			expect(organization.validators).toEqual(
				new OrganizationValidators([node.publicKey])
			);
			expect(organization.description).toBe(tomlInfo.description);
			expect(organization.horizonUrl).toBe(tomlInfo.horizonUrl);
			expect(organization.snapshotStartDate).toEqual(scanTime);
			expect(organization.contactInformation).toEqual(
				OrganizationContactInformation.create({
					officialEmail: tomlInfo.officialEmail,
					physicalAddress: tomlInfo.physicalAddress,
					phoneNumber: tomlInfo.phoneNumber,
					twitter: tomlInfo.twitter,
					keybase: tomlInfo.keybase,
					github: tomlInfo.github,
					dba: tomlInfo.dba
				})
			);
		}
	});

	describe('calculateOrganizationAvailability', () => {
		it('should add measurements for every organization', () => {
			const organizationScan = createOrganizationScan(new Date('2020-01-01'));
			const nodeScan = createNodeScan(new Date('2020-01-01'));
			organizationScan.organizations[0].updateValidators(
				new OrganizationValidators([nodeScan.nodes[0].publicKey]),
				new Date('2020-01-01')
			);

			organizationScan.calculateOrganizationAvailability(nodeScan);

			expect(organizationScan.organizations[0].isAvailable()).toBe(true);
		});
	});

	function createOrganizationScan(scanTime: Date, domain = 'domain.com') {
		return new OrganizationScan(scanTime, [createOrganization(domain)]);
	}
	function createNodeScan(time: Date, domain = 'domain.com') {
		const node = createValidValidatorNode(time);
		node.updateHomeDomain(domain, time);
		const measurement = new NodeMeasurement(time, node);
		measurement.isValidating = true;
		node.addMeasurement(measurement);
		return new NodeScan(time, [node]);
	}
	function createOrganization(domain: string) {
		const organizationId = OrganizationId.create(domain);
		if (organizationId.isErr()) throw new Error('Invalid organizationId');
		return Organization.create(
			organizationId.value,
			domain,
			new Date('2020-01-01')
		);
	}
});

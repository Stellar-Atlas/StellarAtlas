import { createDummyNode } from '@network-scan/domain/node/__fixtures__/createDummyNode.js';
import NodeQuorumSet from '@network-scan/domain/node/NodeQuorumSet.js';
import { QuorumSet } from 'shared';
import NodeDetails from '@network-scan/domain/node/NodeDetails.js';
import NodeGeoDataLocation from '@network-scan/domain/node/NodeGeoDataLocation.js';
import { FbasMapper } from '../FbasMapper.js';
import { FbasAnalysisNode } from '../FbasAnalyzerFacade.js';
import Node from '@network-scan/domain/node/Node.js';
import Organization from '@network-scan/domain/organization/Organization.js';
import { createDummyOrganizationId } from '@network-scan/domain/organization/__fixtures__/createDummyOrganizationId.js';
import { OrganizationValidators } from '@network-scan/domain/organization/OrganizationValidators.js';
import { createDummyPublicKey } from '@network-scan/domain/node/__fixtures__/createDummyPublicKey.js';

describe('FbasMapper', () => {
	describe('mapToFbasAnalysisNode', () => {
		function getNode(
			addQuorumSet = true,
			addDetails = true,
			addGeoData = true,
			addIsp = true
		) {
			const node = createDummyNode();
			if (addQuorumSet) {
				node.updateQuorumSet(
					NodeQuorumSet.create('key', new QuorumSet(1, [], [])),
					new Date()
				);
			}
			if (addDetails) {
				node.updateDetails(
					NodeDetails.create({
						alias: 'alias',
						name: 'name',
						host: 'host',
						historyUrl: 'historyUrl'
					}),
					new Date()
				);
			}
			if (addGeoData) {
				node.updateGeoData(
					NodeGeoDataLocation.create({
						countryCode: 'countryCode',
						countryName: 'countryName',
						latitude: 1,
						longitude: 1
					}),
					new Date()
				);
			}
			if (addIsp) {
				node.updateIsp('isp', new Date());
			}
			return node;
		}

		function assertEquals(fbasAnalysisNode: FbasAnalysisNode, node: Node) {
			expect(fbasAnalysisNode.publicKey).toEqual(node.publicKey.value);
			expect(fbasAnalysisNode.name).toEqual(node.details?.name);
			expect(fbasAnalysisNode.quorumSet).toEqual(node.quorumSet?.quorumSet);
			expect(fbasAnalysisNode.geoData?.countryName).toEqual(
				node.geoData?.countryName
			);
			expect(fbasAnalysisNode.isp).toEqual(node.isp);
		}

		it('should map to FbasAnalysisNode', function () {
			const node = getNode();
			const fbasAnalysisNode = FbasMapper.mapToFbasAnalysisNode(node);
			assertEquals(fbasAnalysisNode, node);
		});

		it('should map to FbasAnalysisNode without geoData', function () {
			const node = getNode(true, true, false, true);
			const fbasAnalysisNode = FbasMapper.mapToFbasAnalysisNode(node);
			expect(fbasAnalysisNode.geoData?.countryName).toBeNull();
		});

		it('should map to FbasAnalysisNode without isp', function () {
			const node = getNode(true, true, true, false);
			const fbasAnalysisNode = FbasMapper.mapToFbasAnalysisNode(node);
			expect(fbasAnalysisNode.isp).toBeNull();
		});

		it('should map to FbasAnalysisNode without quorumSet', function () {
			const node = getNode(false, true, true, true);
			const fbasAnalysisNode = FbasMapper.mapToFbasAnalysisNode(node);
			expect(fbasAnalysisNode.quorumSet).toBeNull();
		});
	});

	describe('mapToFbasAnalysisOrganization', () => {
		it('should map to FbasAnalysisOrganization', function () {
			const organization = Organization.create(
				createDummyOrganizationId(),
				'domain',
				new Date()
			);

			organization.updateName('name', new Date());
			organization.updateValidators(
				new OrganizationValidators([
					createDummyPublicKey(),
					createDummyPublicKey()
				]),
				new Date()
			);

			const fbasAnalysisOrganization =
				FbasMapper.mapToFbasAnalysisOrganization(organization);

			expect(fbasAnalysisOrganization.id).toEqual(
				organization.organizationId.value
			);
			expect(fbasAnalysisOrganization.name).toEqual(organization.name);
			expect(fbasAnalysisOrganization.validators).toHaveLength(
				organization.validators.value.length
			);
			expect(fbasAnalysisOrganization.validators).toEqual(
				organization.validators.value.map((validator) => validator.value)
			);
		});
	});
});

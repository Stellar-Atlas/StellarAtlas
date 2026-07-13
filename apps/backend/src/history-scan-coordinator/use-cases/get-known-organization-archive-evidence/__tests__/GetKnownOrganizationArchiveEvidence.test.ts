import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type Node from '@network-scan/domain/node/Node.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import { GetKnownOrganization } from '@network-scan/use-cases/get-known-organization/GetKnownOrganization.js';
import type { KnownArchiveEvidenceV1 } from 'shared';
import { GetKnownArchiveEvidence } from '../../get-known-archive-evidence/GetKnownArchiveEvidence.js';
import { GetKnownOrganizationArchiveEvidence } from '../GetKnownOrganizationArchiveEvidence.js';

const keyA = 'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH';
const keyB = 'GABMKJM6I25XI4K7U6XWMULOUQIQ27BCTMLS6BYYSOWKTBUXVRJSXHYQ';

describe('GetKnownOrganizationArchiveEvidence', () => {
	it('composes every deduplicated archive root controlled by the organization', async () => {
		const getKnownOrganization = mock<GetKnownOrganization>();
		const nodeRepository = mock<NodeRepository>();
		const getKnownArchiveEvidence = mock<GetKnownArchiveEvidence>();
		const exceptionLogger = mock<ExceptionLogger>();
		getKnownOrganization.execute.mockResolvedValue(
			ok({
				organization: {
					homeDomain: 'org.example',
					id: 'org-id',
					validators: [keyA, keyB]
				}
			} as never)
		);
		nodeRepository.findKnownByPublicKeysOrHomeDomain.mockResolvedValue([
			createNode(keyA, 'https://history.example.com/'),
			createNode(keyB, 'https://HISTORY.example.com')
		]);
		getKnownArchiveEvidence.execute.mockResolvedValue(
			ok({ generatedAt: '2026-07-10T00:00:00.000Z' } as KnownArchiveEvidenceV1)
		);

		const result = await new GetKnownOrganizationArchiveEvidence(
			getKnownOrganization,
			nodeRepository,
			getKnownArchiveEvidence,
			exceptionLogger
		).execute('org-id', { failureLimit: 10 });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value?.organizationId).toBe('org-id');
		expect(
			nodeRepository.findKnownByPublicKeysOrHomeDomain
		).toHaveBeenCalledWith([keyA, keyB], 'org.example');
		expect(nodeRepository.findAllKnown).not.toHaveBeenCalled();
		expect(getKnownArchiveEvidence.execute).toHaveBeenCalledWith({
			nodePublicKeys: [keyA, keyB].toSorted(),
			options: { failureLimit: 10 },
			roots: [
				{
					archiveUrl: 'https://history.example.com',
					archiveUrlIdentity: 'https://history.example.com',
					nodePublicKeys: [keyA, keyB].toSorted()
				}
			],
			sameOrganizationArchiveUrlIdentities: ['https://history.example.com']
		});
	});
});

function createNode(publicKey: string, historyUrl: string): Node {
	return {
		details: { historyUrl },
		homeDomain: null,
		publicKey: { value: publicKey }
	} as unknown as Node;
}

import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type Node from '@network-scan/domain/node/Node.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import type { KnownArchiveEvidenceV1 } from 'shared';
import { GetKnownArchiveEvidence } from '../../get-known-archive-evidence/GetKnownArchiveEvidence.js';
import { GetHistoryArchiveEvidence } from '../GetHistoryArchiveEvidence.js';

describe('GetHistoryArchiveEvidence', () => {
	it('includes every known node that owns the requested archive source', async () => {
		const getKnownArchiveEvidence = mock<GetKnownArchiveEvidence>();
		const nodeRepository = mock<NodeRepository>();
		const publicKey =
			'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH';
		nodeRepository.findKnownByHistoryUrl.mockResolvedValue([
			createNode(publicKey, 'https://HISTORY.example.com/')
		]);
		getKnownArchiveEvidence.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-13T16:00:00.000Z',
				roots: [
					{
						archiveUrl: 'https://history.example.com',
						archiveUrlIdentity: 'https://history.example.com',
						nodePublicKeys: [publicKey]
					}
				]
			} as unknown as KnownArchiveEvidenceV1)
		);

		const result = await new GetHistoryArchiveEvidence(
			getKnownArchiveEvidence,
			nodeRepository
		).execute('https://history.example.com/', { objectLimit: 10 });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.root.nodePublicKeys).toEqual([publicKey]);
		expect(nodeRepository.findKnownByHistoryUrl).toHaveBeenCalledWith(
			'https://history.example.com'
		);
		expect(getKnownArchiveEvidence.execute).toHaveBeenCalledWith({
			fixedArchiveUrlIdentity: 'https://history.example.com',
			nodePublicKeys: [publicKey],
			options: { objectLimit: 10 },
			roots: [
				{
					archiveUrl: 'https://history.example.com',
					archiveUrlIdentity: 'https://history.example.com',
					nodePublicKeys: [publicKey]
				}
			],
			sameOrganizationArchiveUrlIdentities: ['https://history.example.com']
		});
	});
});

function createNode(publicKey: string, historyUrl: string): Node {
	return {
		details: { historyUrl },
		publicKey: { value: publicKey }
	} as unknown as Node;
}

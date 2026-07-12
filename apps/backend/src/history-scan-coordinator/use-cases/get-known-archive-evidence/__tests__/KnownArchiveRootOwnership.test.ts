import { mock } from 'jest-mock-extended';
import type Node from '@network-scan/domain/node/Node.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import type { KnownOrganizationDTO } from '@network-scan/use-cases/get-known-organizations/GetKnownOrganizationsDTO.js';
import {
	getKnownOrganizationArchiveOwnership,
	getOwnedKnownArchiveRoots
} from '../KnownArchiveRootOwnership.js';

const keyA = 'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH';
const keyB = 'GABMKJM6I25XI4K7U6XWMULOUQIQ27BCTMLS6BYYSOWKTBUXVRJSXHYQ';
const keyC = 'GCM6QMP3DLRPTAZW2UZPCPX2LF3SXWXKPMP3GKFZBDSF3QZGV2G5QSTK';
const keyD = 'GBC3KX7JQYJ5QPJWXHN5GZFTFPNCPNQY5ZPPOJ7CLPJ2QILJYOBP2XPE';
const keyE = 'GC7GQEFQXLBSN4L6QT4B7SJUG5J7JGX2XOLGQOAO3LDUZYI4RFDZMVVF';

describe('KnownArchiveRootOwnership', () => {
	it('deduplicates normalized roots while preserving every owning node', () => {
		const roots = getOwnedKnownArchiveRoots([
			{ historyUrl: 'https://history.example.com/', publicKey: 'GB' },
			{ historyUrl: 'https://HISTORY.example.com', publicKey: 'GA' },
			{ historyUrl: 'not-a-url', publicKey: 'GC' }
		]);

		expect(roots).toEqual([
			{
				archiveUrl: 'https://history.example.com',
				archiveUrlIdentity: 'https://history.example.com',
				nodePublicKeys: ['GA', 'GB']
			}
		]);
	});

	it('resolves validators and same-domain known nodes in one stored-node query', async () => {
		const nodeRepository = mock<NodeRepository>();
		nodeRepository.findKnownByPublicKeysOrHomeDomain.mockResolvedValue([
			createNode(keyA, 'https://history-a.example.com', 'org.example'),
			createNode(keyB, 'https://history-b.example.com/', null),
			createNode(keyC, 'https://history-a.example.com/', 'other.example'),
			createNode(keyD, 'https://listener-history.example.com', 'ORG.EXAMPLE.'),
			createNode(keyE, 'https://unrelated.example.com', 'elsewhere.example')
		]);
		const organization = {
			organization: {
				homeDomain: 'org.example',
				id: 'org-id',
				validators: [keyC, keyA, keyB]
			}
		} as unknown as KnownOrganizationDTO;

		const ownership = await getKnownOrganizationArchiveOwnership(
			organization,
			nodeRepository
		);

		expect(
			nodeRepository.findKnownByPublicKeysOrHomeDomain
		).toHaveBeenCalledWith([keyC, keyA, keyB], 'org.example');
		expect(nodeRepository.findAllKnown).not.toHaveBeenCalled();
		expect(ownership.nodePublicKeys).toEqual(
			[keyA, keyB, keyC, keyD].toSorted()
		);
		expect(ownership.roots).toMatchObject([
			{
				archiveUrlIdentity: 'https://history-a.example.com',
				nodePublicKeys: [keyA, keyC].toSorted()
			},
			{
				archiveUrlIdentity: 'https://history-b.example.com',
				nodePublicKeys: [keyB]
			},
			{
				archiveUrlIdentity: 'https://listener-history.example.com',
				nodePublicKeys: [keyD]
			}
		]);
	});
});

function createNode(
	publicKey: string,
	historyUrl: string,
	homeDomain: string | null
): Node {
	return {
		details: { historyUrl },
		homeDomain,
		publicKey: { value: publicKey }
	} as unknown as Node;
}

import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { ScpStatementObservationV1 } from 'shared';
import type { GetKnownNodes } from '../../get-known-nodes/GetKnownNodes.js';
import type { GetScpStatements } from '../../get-scp-statements/GetScpStatements.js';
import { GetScpEvidence } from '../GetScpEvidence.js';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import type { KnownNodeListItemDTO } from '../../get-known-nodes/GetKnownNodesDTO.js';

describe('GetScpEvidence', () => {
	it('builds bounded canonical slot events and organization participation', async () => {
		const getScpStatements = mock<GetScpStatements>();
		const getKnownNodes = mock<GetKnownNodes>();
		const statements = [
			statement('20', 'GA', 'confirm'),
			statement('19', 'GB', 'externalize')
		];
		getScpStatements.executeWithMetadata.mockImplementation(async (request) =>
			ok({
				freshness: 'fresh',
				freshnessMs: 25,
				observations: request.nodeId
					? statements.filter((row) => row.nodeId === request.nodeId)
					: statements,
				observedAt: '2026-07-11T00:00:00.000Z',
				source: 'postgres_canonical'
			})
		);
		getKnownNodes.executeAll.mockResolvedValue(
			ok({
				count: 2,
				generatedAt: '2026-07-11T00:00:00.000Z',
				nodes: [knownNode('GA', 'org-a'), knownNode('GB', 'org-b')],
				scopeTotals: {
					'all-known': 2,
					archived: 0,
					'current-validator': 2,
					listener: 0,
					'public-key-only': 0
				},
				source: 'postgres_canonical'
			})
		);

		const useCase = new GetScpEvidence(getScpStatements, getKnownNodes);
		const slots = await useCase.getLatestSlots(1);
		const organization = await useCase.getOrganization('org-a', 20);

		expect(slots.isOk()).toBe(true);
		if (slots.isErr()) return;
		expect(slots.value).toHaveLength(1);
		expect(slots.value[0]).toMatchObject({
			metadata: { source: 'postgres_canonical', freshness: 'fresh' },
			phaseCounts: { confirm: 1 },
			slotIndex: '20',
			validatorCount: 1
		});
		expect(slots.value[0]?.events[0]).toMatchObject({
			kind: 'commit_observed',
			organizationId: 'org-a'
		});
		expect(organization.isOk()).toBe(true);
		if (organization.isOk())
			expect(
				organization.value
					.flatMap((slot) => slot.events)
					.every((event) => event.organizationId === 'org-a')
			).toBe(true);
		expect(getScpStatements.executeWithMetadata).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 1000, source: 'stored' })
		);
		expect(getScpStatements.executeWithMetadata).toHaveBeenCalledWith(
			expect.objectContaining({ nodeId: 'GA', source: 'stored' })
		);
	});
});

function statement(
	slotIndex: string,
	nodeId: string,
	statementType: 'confirm' | 'externalize'
): ScpStatementObservationV1 {
	const ballot = { counter: 1, value: 'value' };
	return {
		nodeId,
		observedAt: '2026-07-11T00:00:00.000Z',
		observedFromAddress: '127.0.0.1',
		observedFromPeer: nodeId,
		pledges:
			statementType === 'confirm'
				? { ballot, nCommit: 1, nH: 1, nPrepared: 1, quorumSetHash: 'qset' }
				: { commit: ballot, nH: 1, quorumSetHash: 'qset' },
		signature: 'signature',
		slotIndex,
		statementHash: `${slotIndex}-${nodeId}`,
		statementType,
		statementXdr: 'xdr',
		values: [
			{
				closeTime: '2026-07-11T00:00:00.000Z',
				txSetHash: 'tx-set',
				upgradeCount: 0,
				value: 'value'
			}
		]
	};
}

function knownNode(
	publicKey: string,
	organizationId: string
): KnownNodeListItemDTO {
	const node = createDummyNodeV1(publicKey);
	node.organizationId = organizationId;
	return {
		current: true,
		dateDiscovered: '2026-07-11T00:00:00.000Z',
		lastMeasurementAt: null,
		lastSeen: null,
		metadataState: 'snapshot' as const,
		node,
		publicKey,
		scope: 'current-validator' as const,
		snapshotEndDate: null,
		snapshotStartDate: '2026-07-11T00:00:00.000Z'
	};
}

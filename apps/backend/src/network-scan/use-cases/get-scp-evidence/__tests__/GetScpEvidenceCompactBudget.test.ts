import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import type { GetKnownNodes } from '../../get-known-nodes/GetKnownNodes.js';
import type { KnownNodeListItemDTO } from '../../get-known-nodes/GetKnownNodesDTO.js';
import type {
	ScpAnimationStatement,
	GetScpStatements
} from '../../get-scp-statements/GetScpStatements.js';
import { GetScpEvidence } from '../GetScpEvidence.js';

describe('GetScpEvidence compact delivery budgets', () => {
	it('caps dense multi-slot responses by one total event budget', async () => {
		const getScpStatements = mock<GetScpStatements>();
		const getKnownNodes = knownNodes();
		const rows = [
			animationStatement('102', 'a'),
			animationStatement('102', 'b'),
			animationStatement('102', 'c'),
			animationStatement('101', 'd')
		];
		getScpStatements.executeLatestAnimationSlots.mockResolvedValue(
			ok(animationRead(rows))
		);
		const useCase = new GetScpEvidence(getScpStatements, getKnownNodes, {
			compactEventLimit: 3
		});

		const latest = await useCase.getLatestSlots(2);
		const backlog = await useCase.getAnimationBacklog(2);

		expect(latest.isOk()).toBe(true);
		expect(backlog.isOk()).toBe(true);
		if (latest.isErr() || backlog.isErr()) return;
		expect(latest.value.delivery).toMatchObject({
			eventCount: 3,
			eventLimit: 3,
			truncated: true
		});
		expect(latest.value.delivery.nextCursor).toEqual(expect.any(String));
		expect(latest.value.slots.flatMap((slot) => slot.events)).toHaveLength(3);
		expect(backlog.value.delivery).toMatchObject({
			eventCount: 3,
			eventLimit: 3,
			truncated: true
		});
		expect(backlog.value.statementCount).toBe(3);
		expect(
			getScpStatements.executeLatestAnimationSlots
		).toHaveBeenNthCalledWith(1, 2, 4_001);
		expect(
			getScpStatements.executeLatestAnimationSlots
		).toHaveBeenNthCalledWith(2, 2, 4_001);
	});

	it('truncates at the exact serialized UTF-8 byte budget', async () => {
		const getScpStatements = mock<GetScpStatements>();
		const rows = ['a', 'b', 'c'].map((hash) =>
			animationStatement('102', hash, { valueSize: 2_500 })
		);
		getScpStatements.executeLatestAnimationSlots.mockResolvedValue(
			ok(animationRead(rows))
		);
		const useCase = new GetScpEvidence(getScpStatements, knownNodes(), {
			compactByteLimit: 4_096,
			compactEventLimit: 10
		});

		const result = await useCase.getAnimationBacklog(1);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		const serializedBytes = Buffer.byteLength(JSON.stringify(result.value));
		expect(result.value.delivery).toMatchObject({
			byteLimit: 4_096,
			truncated: true
		});
		expect(result.value.delivery.eventCount).toBeGreaterThan(0);
		expect(result.value.delivery.eventCount).toBeLessThan(rows.length);
		expect(result.value.delivery.serializedBytes).toBe(serializedBytes);
		expect(serializedBytes).toBeLessThanOrEqual(4_096);
	});

	it('selects dense phase and organization representatives before extras', async () => {
		const getScpStatements = mock<GetScpStatements>();
		const noise = Array.from({ length: 300 }, (_, index) =>
			animationStatement('102', `noise-${index.toString().padStart(3, '0')}`, {
				nodeId: 'GA',
				observedAt: observedAt(index),
				statementType: 'nominate'
			})
		);
		const phases = ['nominate', 'prepare', 'confirm', 'externalize'] as const;
		const representatives = ['GA', 'GB'].flatMap((nodeId, nodeIndex) =>
			phases.map((statementType, phaseIndex) =>
				animationStatement('102', `${nodeId}-${statementType}`, {
					nodeId,
					observedAt: observedAt(400 + nodeIndex * phases.length + phaseIndex),
					statementType
				})
			)
		);
		const rows = [...noise, ...representatives];
		getScpStatements.executeLatestAnimationSlots
			.mockResolvedValueOnce(ok(animationRead(rows)))
			.mockResolvedValueOnce(ok(animationRead(rows.toReversed())));
		const useCase = new GetScpEvidence(
			getScpStatements,
			knownNodes([
				['GA', 'org-a'],
				['GB', 'org-b']
			])
		);

		const first = await useCase.getLatestSlots(1);
		const reversed = await useCase.getLatestSlots(1);

		expect(first.isOk()).toBe(true);
		expect(reversed.isOk()).toBe(true);
		if (first.isErr() || reversed.isErr()) return;
		const events = first.value.slots.flatMap((slot) => slot.events);
		expect(first.value.delivery).toMatchObject({
			byteLimit: 262_144,
			eventCount: rows.length,
			eventLimit: 512,
			truncated: false
		});
		expect(first.value.delivery.serializedBytes).toBe(
			Buffer.byteLength(JSON.stringify(first.value), 'utf8')
		);
		expect(first.value.delivery.serializedBytes).toBeLessThanOrEqual(262_144);
		expect(
			new Set(
				events.map(
					(event) => `${event.statement.statementType}:${event.organizationId}`
				)
			)
		).toEqual(
			new Set(
				['org-a', 'org-b'].flatMap((organizationId) =>
					phases.map((phase) => `${phase}:${organizationId}`)
				)
			)
		);
		expect(events.map((event) => event.eventId)).toEqual(
			reversed.value.slots.flatMap((slot) =>
				slot.events.map((event) => event.eventId)
			)
		);
		expect(
			getScpStatements.executeLatestAnimationSlots
		).toHaveBeenNthCalledWith(1, 1, 4_001);
	});
});

function animationRead(observations: readonly ScpAnimationStatement[]) {
	return {
		freshness: 'fresh' as const,
		freshnessMs: 10,
		observations,
		observedAt: '2026-07-11T00:00:03.000Z',
		source: 'postgres_canonical' as const
	};
}

function animationStatement(
	slotIndex: string,
	statementHash: string,
	options: {
		readonly nodeId?: string;
		readonly observedAt?: string;
		readonly statementType?: ScpAnimationStatement['statementType'];
		readonly valueSize?: number;
	} = {}
): ScpAnimationStatement {
	return {
		nodeId: options.nodeId ?? `G-${statementHash}`,
		observedAt:
			options.observedAt ??
			`2026-07-11T00:00:0${statementHash.charCodeAt(0) % 4}.000Z`,
		observedFromPeer: `peer-${statementHash}`,
		quorumSetHash: 'qset',
		slotIndex,
		statementHash,
		statementType: options.statementType ?? 'confirm',
		values: [
			{
				closeTime: '1783728000',
				txSetHash: statementHash.repeat(options.valueSize ?? 8)
			}
		]
	};
}

function knownNodes(
	organizations: readonly (readonly [string, string])[] = []
): GetKnownNodes {
	const getKnownNodes = mock<GetKnownNodes>();
	getKnownNodes.executeAll.mockResolvedValue(
		ok({
			count: organizations.length,
			generatedAt: '2026-07-11T00:00:00.000Z',
			nodes: organizations.map(([nodeId, organizationId]) =>
				knownNode(nodeId, organizationId)
			),
			scopeTotals: {
				'all-known': organizations.length,
				archived: 0,
				'current-validator': organizations.length,
				listener: 0,
				'public-key-only': 0
			},
			source: 'postgres_canonical'
		})
	);
	return getKnownNodes;
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
		metadataState: 'snapshot',
		node,
		publicKey,
		scope: 'current-validator',
		snapshotEndDate: null,
		snapshotStartDate: '2026-07-11T00:00:00.000Z'
	};
}

function observedAt(sequence: number): string {
	return new Date(Date.UTC(2026, 6, 11) + sequence).toISOString();
}

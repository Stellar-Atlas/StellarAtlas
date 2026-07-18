import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { ScpStatementObservationRepository } from '@network-scan/domain/scp/ScpStatementObservationRepository.js';
import { ScpStatementObservation } from '@network-scan/domain/scp/ScpStatementObservation.js';
import type { ScpStatementLiveStore } from '@network-scan/domain/scp/ScpStatementLiveStore.js';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import type { GetKnownNodes } from '../../get-known-nodes/GetKnownNodes.js';
import type { KnownNodeListItemDTO } from '../../get-known-nodes/GetKnownNodesDTO.js';
import { GetScpStatements } from '../../get-scp-statements/GetScpStatements.js';
import { decodeScpEvidenceCursor } from '../ScpEvidenceCursor.js';
import { GetScpEvidence } from '../GetScpEvidence.js';

describe('GetScpEvidence detailed pagination', () => {
	it('continues a dense slot from its stable descending cursor without loss', async () => {
		const rows = [
			observation('GA', '200', 'slot-a', 3),
			observation('GB', '200', 'slot-b', 2),
			observation('GC', '200', 'slot-c', 1)
		];
		const { repository, useCase } = setup(rows, [
			knownNode('GA', 'org-a'),
			knownNode('GB', 'org-b'),
			knownNode('GC', 'org-c')
		]);

		const first = await useCase.getSlot('200', 2);
		expect(first.isOk()).toBe(true);
		if (first.isErr()) return;
		expect(first.value.page).toMatchObject({ hasMore: true, limit: 2 });
		expect(pageHashes(first.value)).toEqual(['slot-a', 'slot-b']);
		const cursor = requireCursor(first.value.page.nextCursor);

		const second = await useCase.getSlot('200', 2, cursor);
		expect(second.isOk()).toBe(true);
		if (second.isErr()) return;
		expect(second.value.page).toEqual({
			hasMore: false,
			limit: 2,
			nextCursor: null
		});
		expect(pageHashes(second.value)).toEqual(['slot-c']);
		expect(repository.findLatest).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ limit: 3, order: 'desc', slotIndex: '200' })
		);
		expect(repository.findLatest).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ after: cursor, limit: 3, order: 'desc' })
		);
	});

	it('pages one globally ordered organization query across all validators', async () => {
		const rows = [
			observation('GA', '204', 'org-a-1', 6),
			observation('GB', '203', 'org-b-1', 5),
			observation('GA', '202', 'org-a-2', 4),
			observation('GB', '201', 'org-b-2', 3)
		];
		const { repository, useCase } = setup(rows, [
			knownNode('GA', 'org-shared'),
			knownNode('GB', 'org-shared'),
			knownNode('GC', 'org-other')
		]);

		const first = await useCase.getOrganization('org-shared', 2);
		expect(first.isOk()).toBe(true);
		if (first.isErr()) return;
		const cursor = requireCursor(first.value.page.nextCursor);
		const second = await useCase.getOrganization('org-shared', 2, cursor);
		expect(second.isOk()).toBe(true);
		if (second.isErr()) return;

		expect([...pageHashes(first.value), ...pageHashes(second.value)]).toEqual([
			'org-a-1',
			'org-b-1',
			'org-a-2',
			'org-b-2'
		]);
		expect(first.value.page.hasMore).toBe(true);
		expect(second.value.page.hasMore).toBe(false);
		expect(repository.findLatest).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				limit: 3,
				nodeIds: ['GA', 'GB'],
				order: 'desc'
			})
		);
		expect(repository.findLatest).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				after: cursor,
				limit: 3,
				nodeIds: ['GA', 'GB']
			})
		);
	});
});

function setup(
	rows: readonly ScpStatementObservation[],
	knownNodes: readonly KnownNodeListItemDTO[]
) {
	const repository = mock<ScpStatementObservationRepository>();
	repository.findLatest.mockImplementation(async (filter) =>
		rows
			.filter(
				(row) => filter.nodeId === undefined || row.nodeId === filter.nodeId
			)
			.filter(
				(row) =>
					filter.nodeIds === undefined || filter.nodeIds.includes(row.nodeId)
			)
			.filter(
				(row) =>
					filter.slotIndex === undefined || row.slotIndex === filter.slotIndex
			)
			.filter((row) => isAfter(row, filter.after, filter.order))
			.toSorted((left, right) => compareRows(left, right, filter.order))
			.slice(0, filter.limit)
	);
	const getKnownNodes = mock<GetKnownNodes>();
	getKnownNodes.executeAll.mockResolvedValue(
		ok({
			count: knownNodes.length,
			generatedAt: '2026-07-11T00:00:00.000Z',
			nodes: [...knownNodes],
			scopeTotals: {
				'all-known': knownNodes.length,
				archived: 0,
				'current-validator': knownNodes.length,
				listener: 0,
				'public-key-only': 0
			},
			source: 'postgres_canonical'
		})
	);
	return {
		repository,
		useCase: new GetScpEvidence(
			new GetScpStatements(repository, mock<ScpStatementLiveStore>()),
			getKnownNodes
		)
	};
}

function isAfter(
	row: ScpStatementObservation,
	after:
		| { readonly observedAtMs: number; readonly statementHash: string }
		| undefined,
	order: 'asc' | 'desc' | undefined
): boolean {
	if (after === undefined) return true;
	const comparison =
		row.observedAt.getTime() - after.observedAtMs ||
		row.statementHash.localeCompare(after.statementHash);
	return order === 'asc' ? comparison > 0 : comparison < 0;
}

function compareRows(
	left: ScpStatementObservation,
	right: ScpStatementObservation,
	order: 'asc' | 'desc' | undefined
): number {
	const comparison =
		left.observedAt.getTime() - right.observedAt.getTime() ||
		left.statementHash.localeCompare(right.statementHash);
	return order === 'asc' ? comparison : -comparison;
}

function observation(
	nodeId: string,
	slotIndex: string,
	statementHash: string,
	second: number
): ScpStatementObservation {
	const row = new ScpStatementObservation();
	row.nodeId = nodeId;
	row.observedAt = new Date(`2026-07-11T00:00:0${second}.000Z`);
	row.observedFromPeer = nodeId;
	row.slotIndex = slotIndex;
	row.statementHash = statementHash;
	row.statementType = 'confirm';
	return row;
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

function requireCursor(value: string | null) {
	if (value === null) throw new Error('Expected next cursor');
	const cursor = decodeScpEvidenceCursor(value);
	if (cursor === null) throw new Error('Expected valid next cursor');
	return cursor;
}

function pageHashes(page: {
	readonly slots: readonly {
		readonly events: readonly {
			readonly statement: { readonly statementHash: string };
		}[];
	}[];
}): string[] {
	return page.slots.flatMap((slot) =>
		slot.events.map((event) => event.statement.statementHash)
	);
}

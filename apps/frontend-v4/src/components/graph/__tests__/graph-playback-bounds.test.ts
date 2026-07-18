import type { PublicScpGraphStatement } from '../../../api/types';
import {
	allocateWaveSlotIndex,
	maxWaveInstances,
	type ActiveWave
} from '../graph-wave-animation';
import {
	buildLedgerPlaybackFrames,
	getPlaybackBoundarySlotIndex
} from '../graph-ledger-playback';
import {
	maxQueuedPlaybackLedgers,
	mergePlaybackQueue
} from '../graph-playback-queue';
import {
	maxLedgerAnimationStatements,
	sampleLedgerAnimationStatements
} from '../graph-statement-sampler';

describe('bounded truthful graph playback', () => {
	it('uses the lower of latest closed and one past latest observed', () => {
		expect(getPlaybackBoundarySlotIndex('105', '100')).toBe('101');
		expect(getPlaybackBoundarySlotIndex('100', '100')).toBe('100');
		expect(getPlaybackBoundarySlotIndex('100', '104')).toBe('100');
		expect(getPlaybackBoundarySlotIndex('100', null)).toBe('100');
		expect(getPlaybackBoundarySlotIndex(null, '100')).toBe('101');
	});

	it('samples an adversarial dense ledger deterministically with phase and organization coverage', () => {
		const phases: PublicScpGraphStatement['statementType'][] = [
			...Array.from({ length: 500 }, () => 'nominate' as const),
			...Array.from({ length: 100 }, () => 'prepare' as const),
			...Array.from({ length: 100 }, () => 'confirm' as const),
			...Array.from({ length: 100 }, () => 'externalize' as const)
		];
		const statements = phases.map((phase, index) =>
			createStatement('70000000', index, phase, `validator-${index % 400}`)
		);
		const organizationByNodeId = new Map<string, string | null>();
		for (let index = 0; index < 400; index += 1) {
			organizationByNodeId.set(
				`validator-${index}`,
				`organization-${index % 20}`
			);
		}

		const sample = sampleLedgerAnimationStatements(statements, {
			organizationByNodeId
		});
		const reversedSample = sampleLedgerAnimationStatements(
			statements.toReversed(),
			{ organizationByNodeId }
		);

		expect(sample).toHaveLength(maxLedgerAnimationStatements);
		expect(sample.map(({ statementHash }) => statementHash)).toEqual(
			reversedSample.map(({ statementHash }) => statementHash)
		);
		expect(new Set(sample.map(({ statementType }) => statementType))).toEqual(
			new Set(['nominate', 'prepare', 'confirm', 'externalize'])
		);
		const representedOrganizations = new Set(
			sample.flatMap((statement) => {
				const organizationId = organizationByNodeId.get(statement.nodeId);
				return organizationId ? [organizationId] : [];
			})
		);
		expect(representedOrganizations.size).toBe(20);
		const representedPhaseOrganizations = new Set(
			sample.map(
				(statement) =>
					`${statement.statementType}:${organizationByNodeId.get(statement.nodeId)}`
			)
		);
		expect(representedPhaseOrganizations).toEqual(
			new Set(
				['nominate', 'prepare', 'confirm', 'externalize'].flatMap((phase) =>
					Array.from(
						{ length: 20 },
						(_, index) => `${phase}:organization-${index}`
					)
				)
			)
		);
		expect(new Set(sample.map(({ nodeId }) => nodeId)).size).toBeGreaterThan(
			200
		);
	});

	it('fast-forwards to the newest bounded ledger window when input outruns playback', () => {
		const statements = Array.from({ length: 125 }, (_, index) =>
			createStatement((1_000 + index).toString(), index, 'externalize')
		);
		const ledgers = buildLedgerPlaybackFrames({
			boundarySlotIndex: '1125',
			latestLedgerClosedAt: '2026-07-18T00:10:00.000Z',
			statements
		}).filter((ledger) => ledger.statements.length > 0);
		expect(ledgers).toHaveLength(125);

		const { queue } = mergePlaybackQueue({
			activeSlotIndex: null,
			boundarySlotIndex: '1125',
			completedSignatures: new Map(),
			ledgers,
			minimumExclusiveSlotIndex: null
		});

		expect(queue).toHaveLength(maxQueuedPlaybackLedgers);
		expect(queue.map(({ slotIndex }) => slotIndex)).toEqual([
			'1121',
			'1122',
			'1123',
			'1124'
		]);
	});

	it('does not overwrite an active GPU wave slot when the pool is full', () => {
		const activeWaves = new Map<number, ActiveWave>(
			Array.from({ length: maxWaveInstances }, (_, index) => [
				index,
				{ durationMs: 1_000, index, startedAt: 500 }
			])
		);

		expect(allocateWaveSlotIndex(activeWaves, 0, 1_000)).toBeNull();
		expect(activeWaves.size).toBe(maxWaveInstances);
		expect(activeWaves.get(0)).toEqual({
			durationMs: 1_000,
			index: 0,
			startedAt: 500
		});
	});
});

function createStatement(
	slotIndex: string,
	index: number,
	statementType: PublicScpGraphStatement['statementType'],
	nodeId = `validator-${index}`
): PublicScpGraphStatement {
	const observedAt = new Date(
		Date.parse('2026-07-18T00:00:00.000Z') + index
	).toISOString();
	return {
		nodeId,
		observedAt,
		observedFromPeer: nodeId,
		quorumSetHash: `quorum-${nodeId}`,
		slotIndex,
		statementHash: `statement-${slotIndex}-${index}-${statementType}`,
		statementType,
		values: [
			{
				closeTime: observedAt,
				txSetHash: `tx-${slotIndex}`,
				upgradeCount: 0,
				value: `value-${slotIndex}`
			}
		]
	};
}

import {
	parseScpAnimationBacklog,
	parseScpLatestSlots,
	parseScpSlotEvidenceList
} from '../scp-evidence';

describe('parseScpSlotEvidenceList', () => {
	it('accepts semantic events with canonical provenance and rejects malformed statements', () => {
		const payload = [slotEvidence()];
		const parsed = parseScpSlotEvidenceList(payload);
		expect(parsed?.[0]).toMatchObject({
			metadata: { freshness: 'fresh', source: 'postgres_canonical' },
			phaseCounts: { confirm: 1 },
			slotIndex: '63390000'
		});
		expect(parsed?.[0]?.events[0]).toMatchObject({
			kind: 'commit_observed',
			organizationId: 'org-a',
			statement: {
				quorumSetHash: 'qset',
				values: [{ upgradeCount: 0, value: 'value' }]
			}
		});
		expect(parsed?.[0]?.events[0]?.statement).not.toHaveProperty(
			'statementXdr'
		);
		expect(
			parseScpSlotEvidenceList([
				{ ...slotEvidence(), events: [{ broken: true }] }
			])
		).toBeNull();
	});
});

describe('parseScpLatestSlots', () => {
	it('preserves compact delivery truncation and cursor metadata', () => {
		const delivery = compactDelivery();

		expect(
			parseScpLatestSlots({ delivery, slots: [slotEvidence()] })
		).toMatchObject({
			delivery: {
				eventCount: 1,
				nextCursor: 'opaque-cursor',
				truncated: true
			},
			slots: [{ slotIndex: '63390000' }]
		});
		expect(parseScpLatestSlots([slotEvidence()])).toMatchObject({
			slots: [{ slotIndex: '63390000' }]
		});
	});
});

describe('parseScpAnimationBacklog', () => {
	it('accepts complete compact slots and rejects mismatched counts', () => {
		const evidence = slotEvidence();
		const statement = {
			...evidence.events[0]?.statement,
			quorumSetHash: 'qset'
		};
		const payload = {
			delivery: compactDelivery(),
			metadata: evidence.metadata,
			slots: [{ slotIndex: evidence.slotIndex, statements: [statement] }],
			statementCount: 1
		};

		expect(parseScpAnimationBacklog(payload)).toMatchObject({
			delivery: {
				nextCursor: 'opaque-cursor',
				truncated: true
			},
			metadata: {
				cursor: { observedAtMs: 1, statementHash: 'statement' },
				truncated: true
			},
			slots: [
				{
					slotIndex: '63390000',
					statements: [
						{
							quorumSetHash: 'qset',
							values: [{ upgradeCount: 0, value: 'value' }]
						}
					]
				}
			],
			statementCount: 1
		});
		expect(
			parseScpAnimationBacklog({ ...payload, statementCount: 2 })
		).toBeNull();
		expect(
			parseScpAnimationBacklog({ ...payload, delivery: undefined })
		).not.toBeNull();
	});
});

function compactDelivery() {
	return {
		byteLimit: 1_000_000,
		eventCount: 1,
		eventLimit: 250,
		nextCursor: 'opaque-cursor',
		serializedBytes: 2_048,
		truncated: true
	};
}

function slotEvidence() {
	const statement = {
		nodeId: 'GA',
		observedAt: '2026-07-11T00:00:00.000Z',
		observedFromAddress: '127.0.0.1',
		observedFromPeer: 'peer',
		pledges: {
			ballot: { counter: 1, value: 'value' },
			nCommit: 1,
			nH: 1,
			nPrepared: 1,
			quorumSetHash: 'qset'
		},
		signature: 'signature',
		slotIndex: '63390000',
		statementHash: 'statement',
		statementType: 'confirm',
		statementXdr: 'xdr',
		values: [
			{
				closeTime: '2026-07-11T00:00:00.000Z',
				txSetHash: 'tx',
				upgradeCount: 0,
				value: 'value'
			}
		]
	};
	return {
		events: [
			{
				eventId: 'statement',
				kind: 'commit_observed',
				nodeId: 'GA',
				observedAt: statement.observedAt,
				organizationId: 'org-a',
				quorumSetHash: 'qset',
				slotIndex: statement.slotIndex,
				statement,
				transactionSetHashes: ['tx']
			}
		],
		metadata: {
			cursor: { observedAtMs: 1, statementHash: 'statement' },
			freshness: 'fresh',
			freshnessMs: 10,
			observedAt: statement.observedAt,
			source: 'postgres_canonical',
			truncated: true
		},
		phaseCounts: { confirm: 1, externalize: 0, nominate: 0, prepare: 0 },
		slotIndex: statement.slotIndex,
		statementCount: 1,
		validatorCount: 1
	};
}

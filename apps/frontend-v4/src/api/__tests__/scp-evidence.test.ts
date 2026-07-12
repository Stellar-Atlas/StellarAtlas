import { parseScpSlotEvidenceList } from '../scp-evidence';

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
			organizationId: 'org-a'
		});
		expect(
			parseScpSlotEvidenceList([
				{ ...slotEvidence(), events: [{ broken: true }] }
			])
		).toBeNull();
	});
});

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
			freshness: 'fresh',
			freshnessMs: 10,
			observedAt: statement.observedAt,
			source: 'postgres_canonical'
		},
		phaseCounts: { confirm: 1, externalize: 0, nominate: 0, prepare: 0 },
		slotIndex: statement.slotIndex,
		statementCount: 1,
		validatorCount: 1
	};
}

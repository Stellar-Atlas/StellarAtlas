import type { ScpStatementObservationV1 } from 'shared';
import {
	compareScpStatement,
	createScpStatementStreamState,
	getScpStatementReadCursor,
	getScpStatementReadOrder,
	selectScpStatementDelta
} from '../ScpStatementStreamState.js';

describe('ScpStatementStreamState', () => {
	it('seeds from newest rows and then reads ascending after the cursor', () => {
		const state = createScpStatementStreamState();

		expect(getScpStatementReadCursor(state)).toBeUndefined();
		expect(getScpStatementReadOrder(state)).toBe('desc');

		const seedDelta = selectScpStatementDelta(
			state,
			[
				createStatement('statement-b', '2026-07-05T00:00:01.000Z'),
				createStatement('statement-a', '2026-07-05T00:00:00.000Z')
			].toSorted(compareScpStatement)
		);

		expect(seedDelta.map((statement) => statement.statementHash)).toEqual([
			'statement-a',
			'statement-b'
		]);
		expect(getScpStatementReadCursor(state)).toEqual({
			observedAtMs: new Date('2026-07-05T00:00:01.000Z').getTime(),
			statementHash: 'statement-b'
		});
		expect(getScpStatementReadOrder(state)).toBe('asc');
	});

	it('does not select older unique statements after the cursor advances', () => {
		const state = createScpStatementStreamState();
		selectScpStatementDelta(state, [
			createStatement('statement-current', '2026-07-05T00:00:01.000Z')
		]);

		const delta = selectScpStatementDelta(state, [
			createStatement('statement-older', '2026-07-05T00:00:00.000Z')
		]);

		expect(delta).toEqual([]);
	});
});

function createStatement(
	statementHash: string,
	observedAt: string
): ScpStatementObservationV1 {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt,
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: { accepted: [], quorumSetHash: '', votes: [] },
		signature: '',
		slotIndex: '63326550',
		statementHash,
		statementType: 'nominate',
		statementXdr: '',
		values: []
	};
}

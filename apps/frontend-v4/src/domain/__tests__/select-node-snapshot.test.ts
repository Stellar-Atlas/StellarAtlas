import { selectNodeSnapshot } from '../select-node-snapshot';
import {
	knownNodeFixture,
	networkFixture,
	nodeFixture,
	quorum
} from '../../components/nodes/__tests__/node-detail-fixtures';

describe('node detail snapshot selection', () => {
	it('prefers the matching current record without mutating retained metadata', () => {
		const retained = nodeFixture('selected', {
			dateUpdated: '2026-07-04T00:00:00Z',
			versionStr: 'stellar-core 27.0.0',
			quorumSet: quorum('old')
		});
		const known = knownNodeFixture(retained);
		const current = nodeFixture('selected', {
			dateUpdated: '2026-09-08T00:00:00Z',
			versionStr: 'stellar-core 28.0.0',
			quorumSet: quorum('new')
		});
		const selected = selectNodeSnapshot(
			networkFixture([nodeFixture('unrelated'), current]),
			known.publicKey,
			known.node
		);
		expect(selected).toBe(current);
		expect(selected?.versionStr).toBe('stellar-core 28.0.0');
		expect(selected?.dateUpdated).toBe('2026-09-08T00:00:00Z');
		expect(selected?.quorumSet).toEqual(quorum('new'));
		expect(known.node).toBe(retained);
		expect(known.snapshotStartDate).toBe('2026-07-04T00:00:00Z');
	});
	it('preserves an unchanged metadata timestamp rather than inventing a new observation date', () => {
		const current = nodeFixture('selected', {
			dateUpdated: '2026-07-04T00:00:00Z'
		});
		expect(
			selectNodeSnapshot(networkFixture([current]), 'selected', current)
				?.dateUpdated
		).toBe('2026-07-04T00:00:00Z');
	});
	it('retains historical-only snapshots and leaves public-key-only metadata absent', () => {
		const retained = nodeFixture('historical');
		const network = networkFixture([nodeFixture('unrelated')]);
		expect(selectNodeSnapshot(network, 'historical', retained)).toBe(retained);
		expect(selectNodeSnapshot(network, 'unknown', null)).toBeNull();
	});
	it('uses a current record when the known entry has no retained snapshot', () => {
		const current = nodeFixture('selected');
		expect(
			selectNodeSnapshot(networkFixture([current]), 'selected', null)
		).toBe(current);
	});
});

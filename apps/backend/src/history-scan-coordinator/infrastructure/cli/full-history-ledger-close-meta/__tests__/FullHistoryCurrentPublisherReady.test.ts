import { currentPublisherReadyIdentity, parseCurrentPublisherReadyPath } from '../FullHistoryCurrentPublisherReady.js';

describe('standing current publisher identity', () => {
	const bootId = 'abcdabcd-abcd-abcd-abcd-abcdabcdabcd';
	const marker = {
		version: 1, bootId, invocationId: 'a'.repeat(32), pid: 42,
		startTicks: '901', minimumLedger: 65_366_208, maximumWriteBytes: '34359738368'
	};
	it('binds readiness to the same boot and minimum ledger', () => {
		expect(currentPublisherReadyIdentity(marker, bootId, marker.minimumLedger)).toEqual({ pid: 42, startTicks: '901' });
		expect(currentPublisherReadyIdentity(marker, 'other-boot', marker.minimumLedger)).toBeNull();
		expect(currentPublisherReadyIdentity(marker, bootId, marker.minimumLedger + 1)).toBeNull();
	});
	it('rejects ambiguous, stale-shaped, or unbounded publisher records', () => {
		for (const change of [
			{ pid: 1 }, { startTicks: '0' }, { invocationId: 'x' }, { maximumWriteBytes: '34359738369' },
			{ maximumWriteBytes: '1073741823' }, { extra: true }
		]) expect(currentPublisherReadyIdentity({ ...marker, ...change }, bootId, marker.minimumLedger)).toBeNull();
	});
	it('requires a canonical pathname in a runtime directory', () => {
		expect(parseCurrentPublisherReadyPath('/run/publisher/current.json')).toBe('/run/publisher/current.json');
		for (const path of [undefined, '/run/current.json', '/tmp/current.json', '/run/../run/publisher/current.json'])
			expect(() => parseCurrentPublisherReadyPath(path)).toThrow(/readiness file/);
	});
});

import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import type NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import type { ScpStatementObservationRepository } from '@network-scan/domain/scp/ScpStatementObservationRepository.js';
import { GetLatestObservedLedger } from '../GetLatestObservedLedger.js';

describe('GetLatestObservedLedger', () => {
	afterEach(() => jest.useRealTimers());

	it('rejects a stale completed network scan instead of presenting it as live', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:03:00.000Z'));
		const { networkScanRepository, scpRepository, sut } = setup();
		scpRepository.findLatestObservedLedger.mockResolvedValue(null);
		networkScanRepository.findLatest.mockResolvedValue(
			createNetworkScan('100', '2026-07-10T12:00:00.000Z')
		);

		const result = await sut.execute();
		expect(result._unsafeUnwrap()).toBeNull();
	});

	it('exposes the fresh dedicated SCP collector watermark with labels', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:10.000Z'));
		const { networkScanRepository, scpRepository, sut } = setup();
		scpRepository.findLatestObservedLedger.mockResolvedValue({
			closedAt: new Date('2026-07-10T12:00:05.000Z'),
			observedAt: new Date('2026-07-10T12:00:06.000Z'),
			sequence: '200',
			source: 'scp_live_collector'
		});
		networkScanRepository.findLatest.mockResolvedValue(
			createNetworkScan('100', '2026-07-10T11:57:00.000Z')
		);

		const result = await sut.execute();

		expect(result._unsafeUnwrap()).toEqual({
			closedAt: '2026-07-10T12:00:05.000Z',
			freshness: 'fresh',
			freshnessMs: 5_000,
			observedAt: '2026-07-10T12:00:06.000Z',
			protocolVersion: null,
			sequence: '200',
			source: 'scp_live_collector'
		});
		expect(networkScanRepository.findLatest).not.toHaveBeenCalled();
	});
});

function setup() {
	const networkScanRepository = mock<NetworkScanRepository>();
	const scpRepository = mock<ScpStatementObservationRepository>();
	return {
		networkScanRepository,
		scpRepository,
		sut: new GetLatestObservedLedger(networkScanRepository, scpRepository)
	};
}

function createNetworkScan(sequence: string, closedAt: string): NetworkScan {
	return {
		latestLedger: BigInt(sequence),
		latestLedgerCloseTime: new Date(closedAt),
		time: new Date(closedAt)
	} as NetworkScan;
}

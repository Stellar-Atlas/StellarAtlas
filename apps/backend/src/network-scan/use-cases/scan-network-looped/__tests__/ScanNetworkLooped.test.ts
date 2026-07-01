import { ScanNetworkLooped } from '../ScanNetworkLooped.js';
import { mock } from 'jest-mock-extended';
import { ScanNetwork } from '../../scan-network/ScanNetwork.js';
import { LoopTimer } from '../../../../core/services/LoopTimer.js';
import type { ExceptionLogger } from '../../../../core/services/ExceptionLogger.js';
import type { Logger } from 'logger';
import { err, ok } from 'neverthrow';

class TestScanNetworkLooped extends ScanNetworkLooped {
	public readonly waitTimes: number[] = [];

	protected override async waitForNextRun(waitTimeMs: number): Promise<void> {
		this.waitTimes.push(waitTimeMs);
	}
}

describe('ScanNetworkLooped', () => {
	it('should loop network scans and only request to update the network config the first time', function (done) {
		const { scanNetwork, useCase, loopTimer } = setupSUT();

		let executeCount = 0;
		const expectedExecuteCount = 2;
		useCase.execute(
			{
				loopIntervalMs: 10,
				dryRun: true
			},
			() => {
				executeCount++;
				if (executeCount === expectedExecuteCount)
					useCase.shutDown(() => {
						expect(scanNetwork.execute).toHaveBeenCalledTimes(
							expectedExecuteCount
						);
						expect(loopTimer.start).toHaveBeenCalledTimes(expectedExecuteCount);
						expect(loopTimer.stop).toHaveBeenCalledTimes(expectedExecuteCount);
						expect(scanNetwork.execute).toHaveBeenCalledWith({
							updateNetwork: true,
							dryRun: true
						});
						expect(scanNetwork.execute).toHaveBeenLastCalledWith({
							updateNetwork: false,
							dryRun: true
						});
						done();
					});
			}
		);
	});

	it('should capture exception when network update exceeds expected run time', function () {
		const SUT = setupSUT();
		SUT.loopTimer.loopExceededMaxTime.mockReturnValue(true);
		SUT.useCase.execute(
			{
				loopIntervalMs: 10,
				dryRun: true
			},
			() => {
				SUT.useCase.shutDown(() => {
					expect(SUT.exceptionLogger.captureException).toHaveBeenCalledWith(
						new Error('Network update exceeding expected run time')
					);
				});
			}
		);
	});

	it('should return error when network scan fails', async function () {
		const SUT = setupSUT();
		SUT.scanNetwork.execute.mockResolvedValue(err(new Error()));
		const result = await SUT.useCase.execute({
			loopIntervalMs: 10,
			dryRun: true
		});

		expect(result.isErr()).toBe(true);
	});

	it('should sleep when network update is less then expected run time', async function () {
		const SUT = setupSUT();
		SUT.loopTimer.loopExceededMaxTime.mockReturnValue(false);
		SUT.loopTimer.getRemainingTime.mockReturnValue(100);

		await SUT.useCase.execute(
			{
				loopIntervalMs: 10,
				dryRun: true
			},
			() => {
				SUT.useCase.shutDown(() => undefined);
			}
		);
		expect(SUT.useCase.waitTimes).toEqual([100]);
	});

	function setupSUT() {
		const scanNetwork = mock<ScanNetwork>();
		scanNetwork.execute.mockResolvedValue(ok(undefined));
		scanNetwork.shutDown.mockImplementation((callback) => callback());
		const loopTimer = mock<LoopTimer>();
		const exceptionLogger = mock<ExceptionLogger>();
		const useCase = new TestScanNetworkLooped(
			scanNetwork,
			loopTimer,
			exceptionLogger,
			mock<Logger>()
		);
		return { scanNetwork, useCase, loopTimer, exceptionLogger };
	}
});

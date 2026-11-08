import { FullHistoryLedgerCloseMetaAdmissionRecovery as Recovery } from '../FullHistoryLedgerCloseMetaAdmissionRecovery.js';

const limits = {
	maximumDatabaseConnectionBasisPoints: 7_500,
	maximumDatabaseProbeMilliseconds: 1_000,
	maximumIoFullPressureBasisPoints: 4_000,
	maximumIoSomePressureBasisPoints: 5_000,
	maximumMd0InflightRequests: 256,
	recoveryHealthySamplesRequired: 3
};
const pressure = {
	databaseConnectionBasisPoints: 1_200,
	databaseProbeMilliseconds: 5,
	ioFullPressureBasisPoints: 2_400,
	ioSomePressureBasisPoints: 2_800,
	md0InflightRequests: 1_245
};

describe('FullHistoryLedgerCloseMetaAdmissionRecovery current-source admission', () => {
	it.each([{}, { skipMd0InflightLimit: false }])(
		'retains the md0 guard when skipping is omitted or false: %j',
		options => {
			const recovery = new Recovery({ ...limits, ...options });
			expect(recovery.evaluate(pressure)).toEqual(expect.objectContaining({
				admitted: false,
				reasons: ['md0-inflight-pressure']
			}));
		}
	);

	it('admits current-source pressure when only the md0 limit is skipped', () => {
		const recovery = new Recovery({ ...limits, skipMd0InflightLimit: true });
		expect(recovery.evaluate(pressure)).toEqual(expect.objectContaining({ admitted: true }));
	});

	it('retains the full-IO guard when the md0 limit is skipped', () => {
		const recovery = new Recovery({ ...limits, skipMd0InflightLimit: true });
		expect(recovery.evaluate({ ...pressure, ioFullPressureBasisPoints: 4_001 }))
			.toEqual(expect.objectContaining({
				admitted: false,
				reasons: ['io-full-pressure']
			}));
	});
});

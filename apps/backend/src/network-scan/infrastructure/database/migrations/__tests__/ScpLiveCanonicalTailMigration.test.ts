import { ScpLiveCanonicalTailMigration1784800000000 } from '../1784800000000-ScpLiveCanonicalTailMigration.js';

describe('ScpLiveCanonicalTailMigration1784800000000', () => {
	it('creates bounded projection events and a singleton live ledger watermark', async () => {
		const queryRunner = { query: jest.fn() };

		await new ScpLiveCanonicalTailMigration1784800000000().up(
			queryRunner as never
		);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('scp_statement_projection_event')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('IDX_scp_projection_event_created_at')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('scp_latest_observed_ledger')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining("'scp_live_collector'")
		);
	});

	it('drops both SCP live support tables', async () => {
		const queryRunner = { query: jest.fn() };

		await new ScpLiveCanonicalTailMigration1784800000000().down(
			queryRunner as never
		);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'drop table if exists "scp_latest_observed_ledger"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'drop table if exists "scp_statement_projection_event"'
			)
		);
	});
});

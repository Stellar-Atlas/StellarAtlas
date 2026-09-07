import { createArchiveMaintenanceReporter } from '../ArchiveMaintenanceReporter.js';

describe('archive dispatcher maintenance diagnostics', () => {
	it('reports the first deferral and aggregates later warnings without delaying work', () => {
		let time = 1000;
		const warn = jest.fn();
		const report = createArchiveMaintenanceReporter({ warn }, () => time);
		report('57014');
		report('55P03');
		report('57014');
		expect(warn).toHaveBeenCalledTimes(1);
		time += 60_000;
		report('40P01');
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn.mock.calls[1]?.[1]).toMatchObject({
			sqlState: '40P01',
			deferredSinceReport: 3
		});
	});
});

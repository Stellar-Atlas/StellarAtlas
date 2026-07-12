import {
	calculateHistoryArchivePlanningPressure,
	historyArchiveMinimumWatermark
} from '../HistoryArchiveObjectPlanningPolicy.js';

describe('HistoryArchiveObjectPlanningPolicy', () => {
	it('keeps an idle producer to two consumer waves', () => {
		expect(
			calculateHistoryArchivePlanningPressure({
				outstandingObjects: 0,
				recentCompletions: 0
			})
		).toEqual({
			availableSlots: historyArchiveMinimumWatermark,
			outstandingObjects: 0,
			recentCompletions: 0,
			watermark: historyArchiveMinimumWatermark
		});
	});

	it('does not amplify runnable backlog from measured throughput', () => {
		expect(
			calculateHistoryArchivePlanningPressure({
				outstandingObjects: 100,
				recentCompletions: 300
			})
		).toMatchObject({
			availableSlots: 0,
			watermark: historyArchiveMinimumWatermark
		});
		expect(
			calculateHistoryArchivePlanningPressure({
				outstandingObjects: 0,
				recentCompletions: 100_000
			})
		).toMatchObject({
			availableSlots: historyArchiveMinimumWatermark,
			watermark: historyArchiveMinimumWatermark
		});
	});

	it('stops promotion at the current watermark', () => {
		expect(
			calculateHistoryArchivePlanningPressure({
				outstandingObjects: historyArchiveMinimumWatermark + 1,
				recentCompletions: 100_000
			})
		).toMatchObject({ availableSlots: 0 });
	});
});

import {
	calculateHistoryArchivePlanningPressure,
	historyArchiveMaximumWatermark,
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

	it('tracks ten minutes of measured throughput and caps amplification', () => {
		expect(
			calculateHistoryArchivePlanningPressure({
				outstandingObjects: 100,
				recentCompletions: 300
			})
		).toMatchObject({ availableSlots: 100, watermark: 200 });
		expect(
			calculateHistoryArchivePlanningPressure({
				outstandingObjects: 0,
				recentCompletions: 100_000
			})
		).toMatchObject({
			availableSlots: historyArchiveMaximumWatermark,
			watermark: historyArchiveMaximumWatermark
		});
	});

	it('stops promotion at the current watermark', () => {
		expect(
			calculateHistoryArchivePlanningPressure({
				outstandingObjects: historyArchiveMaximumWatermark + 1,
				recentCompletions: 100_000
			})
		).toMatchObject({ availableSlots: 0 });
	});
});

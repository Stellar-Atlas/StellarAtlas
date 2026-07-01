import { MaxCrawlTimeManager } from '../max-crawl-time-manager';

describe('MaxCrawlTimeManager', () => {
	describe('setTimer', () => {
		it('should set a timer', (resolve) => {
			// Arrange
			const maxCrawlTimeManager = new MaxCrawlTimeManager();
			const onMaxCrawlTime = jest.fn();
			const maxCrawlTime = 200;
			// Act
			maxCrawlTimeManager.setTimer(maxCrawlTime, onMaxCrawlTime);
			setTimeout(() => {
				expect(onMaxCrawlTime).toHaveBeenCalled();
				resolve();
			}, 300);
			// Assert
		});
	});
	describe('clearTimer', () => {
		it('should clear the timer', (resolve) => {
			// Arrange
			const maxCrawlTimeManager = new MaxCrawlTimeManager();
			const onMaxCrawlTime = jest.fn();
			const maxCrawlTime = 200;
			maxCrawlTimeManager.setTimer(maxCrawlTime, onMaxCrawlTime);
			maxCrawlTimeManager.clearTimer();
			setTimeout(() => {
				expect(onMaxCrawlTime).not.toHaveBeenCalled();
				resolve();
			}, 300);
		});
	});
});

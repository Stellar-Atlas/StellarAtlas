import { AsyncCrawlQueue } from '../crawl-queue';
import { Crawl } from '../crawl';
import { CrawlTask } from '../crawl-task';
import { mock } from 'jest-mock-extended';

function createCrawlTask(): CrawlTask {
	return {
		connectCallback: jest.fn(),
		crawl: mock<Crawl>(),
		nodeAddress: ['localhost', 11625]
	};
}

describe('CrawlQueue', () => {
	it('should initialize the crawl queue', () => {
		const crawlQueue = new AsyncCrawlQueue(10);
		crawlQueue.initialize(() => {});
		expect(crawlQueue).toHaveProperty('_crawlQueue');
	});

	it('should push a crawl task', () => {
		const crawlQueue = new AsyncCrawlQueue(10);
		crawlQueue.initialize(() => {});
		crawlQueue.push(createCrawlTask(), () => {});
		expect(crawlQueue.length()).toEqual(1);
	});

	it('should return the length of the queue', () => {
		const crawlQueue = new AsyncCrawlQueue(10);
		crawlQueue.initialize(() => {});
		crawlQueue.push(createCrawlTask(), () => {});
		crawlQueue.push(createCrawlTask(), () => {});
		expect(crawlQueue.length()).toEqual(2);
	});

	it('should throw an error if crawl queue is not set up', () => {
		const crawlQueue = new AsyncCrawlQueue(10);
		expect(() => crawlQueue.length()).toThrow('Crawl queue not set up');
	});

	it('should call execute the workers and call the drain function', (resolve) => {
		const crawlQueue = new AsyncCrawlQueue(10);
		let counter = 0;

		crawlQueue.initialize((_task, done) => {
			//process task
			counter++;
			done();
		});

		crawlQueue.push(createCrawlTask(), () => {
			//task done callback
		});

		crawlQueue.onDrain(() => {
			expect(counter).toEqual(1);
			expect(crawlQueue.length()).toEqual(0);
			expect(crawlQueue.activeTasks()).toEqual([]);
			resolve();
		});
	});

	it('should return the active workers', async () => {
		const crawlQueue = new AsyncCrawlQueue(10);
		let releaseTask = () => {};
		const taskCanFinish = new Promise<void>((resolve) => {
			releaseTask = resolve;
		});
		const taskStarted = new Promise<void>((resolve) => {
			crawlQueue.initialize((_task, done) => {
				resolve();
				taskCanFinish.then(() => done()).catch(done);
			});
		});
		const drained = new Promise<void>((resolve) => crawlQueue.onDrain(resolve));

		crawlQueue.push(createCrawlTask(), () => {});

		await taskStarted;
		expect(crawlQueue.activeTasks().length).toEqual(1);

		releaseTask();
		await drained;
		expect(crawlQueue.activeTasks()).toEqual([]);
	});
});

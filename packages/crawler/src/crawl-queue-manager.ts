import pino from 'pino';
import { AsyncResultCallback, CrawlQueue } from './crawl-queue.js';
import { CrawlTask } from './crawl-task.js';

export class CrawlQueueManager {
	constructor(
		private crawlQueue: CrawlQueue,
		private logger: pino.Logger
	) {
		this.crawlQueue.initialize(this.performCrawlQueueTask.bind(this));
	}

	public addCrawlTask(crawlTask: CrawlTask): void {
		this.crawlQueue.push(crawlTask, (error?: Error) => {
			if (error) {
				this.logger.error(
					{ peer: crawlTask.nodeAddress[0] + ':' + crawlTask.nodeAddress[1] },
					error.message
				);
			}
		});
	}

	public onDrain(callback: () => void) {
		this.crawlQueue.onDrain(callback);
	}

	public queueLength(): number {
		return this.crawlQueue.length();
	}

	private performCrawlQueueTask(
		crawlQueueTask: CrawlTask,
		crawlQueueTaskDone: AsyncResultCallback<void>
	): void {
		crawlQueueTask.crawl.crawlQueueTaskDoneCallbacks.set(
			crawlQueueTask.nodeAddress.join(':'),
			crawlQueueTaskDone
		);

		crawlQueueTask.connectCallback();
	}

	public completeCrawlQueueTask(
		crawlQueueTaskDoneCallbacks: Map<string, AsyncResultCallback<void>>,
		nodeAddress: string
	): void {
		const taskDoneCallback = crawlQueueTaskDoneCallbacks.get(nodeAddress);
		if (taskDoneCallback) {
			taskDoneCallback();
			crawlQueueTaskDoneCallbacks.delete(nodeAddress);
		}
	}
}

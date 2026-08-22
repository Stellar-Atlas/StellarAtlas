import type { Worker } from 'node:cluster';
import { HistoryArchiveDownloadPermitCoordinator } from '../HistoryArchiveDownloadPermit.js';

const requestType = 'history-archive-download-permit-request';
const releaseType = 'history-archive-download-permit-release';

describe('HistoryArchiveDownloadPermitCoordinator', () => {
	it('grants multiple independent permits to one worker process', () => {
		const coordinator = new HistoryArchiveDownloadPermitCoordinator(2);
		const worker = createWorker(7);

		coordinator.handleMessage(worker, {
			requestId: 'request-1',
			type: requestType
		});
		coordinator.handleMessage(worker, {
			requestId: 'request-2',
			type: requestType
		});
		coordinator.handleMessage(worker, {
			requestId: 'request-3',
			type: requestType
		});

		expect(worker.send).toHaveBeenCalledTimes(2);
		expect(worker.send).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ requestId: 'request-1' })
		);
		expect(worker.send).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ requestId: 'request-2' })
		);

		coordinator.handleMessage(worker, {
			requestId: 'request-1',
			type: releaseType
		});

		expect(worker.send).toHaveBeenCalledTimes(3);
		expect(worker.send).toHaveBeenLastCalledWith(
			expect.objectContaining({ requestId: 'request-3' })
		);
	});

	it('releases every permit owned by an exited process', () => {
		const coordinator = new HistoryArchiveDownloadPermitCoordinator(2);
		const first = createWorker(7);
		const second = createWorker(8);

		for (const requestId of ['request-1', 'request-2']) {
			coordinator.handleMessage(first, { requestId, type: requestType });
		}
		coordinator.handleMessage(second, {
			requestId: 'request-3',
			type: requestType
		});
		coordinator.removeWorker(first.id);

		expect(second.send).toHaveBeenCalledWith(
			expect.objectContaining({ requestId: 'request-3' })
		);
	});
});

function createWorker(id: number): Worker {
	return {
		id,
		isConnected: () => true,
		send: jest.fn()
	} as unknown as Worker;
}

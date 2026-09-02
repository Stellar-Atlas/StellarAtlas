import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	activateHistoryArchiveObjects,
	deduplicateHistoryArchiveObjects
} from '../HistoryArchiveObjectPlanStore.js';

describe('history archive plan input deduplication', () => {
	it('collapses repeated root/type/key entries and preserves ready work', () => {
		const archiveUrl = 'https://duplicate-fanout.example/history';
		const waiting = bucketObject(archiveUrl, false);
		const ready = bucketObject(archiveUrl, true);
		const otherRoot = bucketObject(
			'https://other-fanout.example/history',
			true
		);

		const deduplicated = deduplicateHistoryArchiveObjects([
			waiting,
			ready,
			otherRoot
		]);

		expect(deduplicated).toHaveLength(2);
		expect(deduplicated[0]).toBe(ready);
		expect(deduplicated[1]).toBe(otherRoot);
	});

	it('keeps fanout root-safe without taking the global admission lock', async () => {
		const manager = {
			query: jest
				.fn()
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ active: 1, ready: 0 }])
		};
		const repository = {
			manager: {
				transaction: jest.fn(
					async (work: (value: typeof manager) => Promise<number>) =>
						await work(manager)
				)
			}
		};

		await activateHistoryArchiveObjects(repository as never, [
			bucketObject('https://fanout.example/history', true)
		]);

		expect(manager.query).toHaveBeenCalledTimes(2);
		expect(String(manager.query.mock.calls[0]?.[0])).toContain('1784950002');
		expect(String(manager.query.mock.calls[0]?.[0])).not.toContain(
			'history_archive_execution_reconciliation'
		);
		const activationSql = String(manager.query.mock.calls[1]?.[0]);
		expect(activationSql).toContain(`input."objectType" = 'bucket'`);
		expect(activationSql).toContain('queued."bucketHash" = input."bucketHash"');
		expect(activationSql).toContain(
			'on conflict ("objectRemoteId") do nothing'
		);
	});
});

function bucketObject(
	archiveUrl: string,
	dependencyReady: boolean
): HistoryArchiveObject {
	const bucketHash = 'a'.repeat(64);
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketHash,
		dependencyReady,
		objectKey: `bucket:${bucketHash}`,
		objectOrder: 50,
		objectType: 'bucket',
		objectUrl: `${archiveUrl}/bucket-${bucketHash}.xdr.gz`
	});
}

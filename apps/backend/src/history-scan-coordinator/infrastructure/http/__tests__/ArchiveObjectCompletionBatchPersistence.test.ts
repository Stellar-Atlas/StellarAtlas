import 'reflect-metadata';
import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { registerArchiveObjectCompletionBatchRoute } from '../ArchiveObjectCompletionBatchRoute.js';
import { CompleteHistoryArchiveObject } from '../../../use-cases/complete-history-archive-object/CompleteHistoryArchiveObject.js';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveStateRepository } from '../../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import type { HistoryArchiveObjectEventRecorder } from '../../../use-cases/record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';

it('passes a ten-result HTTP batch through the real coalescer into one repository write', async () => {
	const repository = mock<HistoryArchiveObjectRepository>();
	const objects = Array.from({ length: 10 }, (_, index) => {
		const hash = index.toString(16).padStart(64, '0');
		return new HistoryArchiveObject({
			archiveUrl: 'https://archive.example',
			archiveUrlIdentity: 'https://archive.example',
			bucketHash: hash,
			objectKey: `bucket:${hash}`,
			objectOrder: 50,
			objectType: 'bucket',
			objectUrl: `https://archive.example/bucket-${hash}.xdr.gz`,
			remoteId: `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, '0')}`,
			status: 'scanning'
		});
	});
	repository.findByRemoteIds.mockResolvedValue(objects);
	repository.markObjectsVerified.mockImplementation(
		async (values) => new Set(values.map((value) => value.remoteId))
	);
	repository.enqueueCheckpointProofRefreshes.mockResolvedValue(0);
	const useCase = new CompleteHistoryArchiveObject(
		repository,
		mock<HistoryArchiveStateRepository>(),
		mock<HistoryArchiveObjectEventRecorder>(),
		mock<HistoryArchiveCheckpointProofRepository>()
	);
	const app = express();
	app.use(express.json());
	registerArchiveObjectCompletionBatchRoute(app, {
		userName: 'worker',
		password: 'test-only',
		completeHistoryArchiveObject: useCase
	});
	const response = await request(app)
		.post('/archive-object-jobs/complete-batch')
		.auth('worker', 'test-only')
		.send({
			items: objects.map((object) => ({
				remoteId: object.remoteId,
				completion: {
					scheduler: 'broker',
					executionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
					claimAttempt: 1,
					bytesDownloaded: 128
				}
			}))
		})
		.expect(200);
	expect(repository.findByRemoteIds).toHaveBeenCalledTimes(1);
	expect(repository.markObjectsVerified).toHaveBeenCalledTimes(1);
	expect(repository.markObjectsVerified.mock.calls[0]![0]).toHaveLength(10);
	expect(response.body.items).toHaveLength(10);
	expect(
		response.body.items.every(
			(item: { status: string }) => item.status === 'accepted'
		)
	).toBe(true);
	await new Promise<void>((resolve) => setImmediate(resolve));
});

import express from 'express';
import request from 'supertest';
import { err, ok, type Result } from 'neverthrow';
import { registerArchiveObjectCompletionBatchRoute } from '../ArchiveObjectCompletionBatchRoute.js';

const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const executionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const path = '/archive-object-jobs/complete-batch';
const completion = {
	scheduler: 'broker',
	executionId,
	claimAttempt: 2,
	bytesDownloaded: 64
};

function fixture() {
	const execute = jest.fn(async (): Promise<Result<boolean, Error>> =>
		ok(true)
	);
	const app = express();
	app.use(express.json());
	registerArchiveObjectCompletionBatchRoute(app, {
		userName: 'worker',
		password: 'test-only',
		completeHistoryArchiveObject: { execute }
	});
	return {
		app,
		execute,
		post: () => request(app).post(path).auth('worker', 'test-only')
	};
}

describe('archive completion batch endpoint', () => {
	it('requires worker authentication before any persistence', async () => {
		const { app, execute } = fixture();
		await request(app)
			.post(path)
			.send({ items: [{ remoteId: first, completion }] })
			.expect(401);
		expect(execute).not.toHaveBeenCalled();
	});
	it('admits all items concurrently into the existing write coalescer', async () => {
		const { post, execute } = fixture();
		const resolvers: ((value: Result<boolean, Error>) => void)[] = [];
		execute.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvers.push(resolve);
					if (resolvers.length === 2)
						resolvers.forEach((done) => done(ok(true)));
				})
		);
		const response = await post()
			.send({
				items: [first, second].map((remoteId) => ({ remoteId, completion }))
			})
			.expect(200);
		expect(execute).toHaveBeenCalledTimes(2);
		expect(response.body.items).toEqual(
			[first, second].map((remoteId) => ({
				remoteId,
				claimAttempt: 2,
				executionId,
				status: 'accepted'
			}))
		);
	});
	it.each([
		{},
		{ items: [] },
		{
			items: [
				{ remoteId: first, completion },
				{ remoteId: second, completion: { ...completion, claimAttempt: 0 } }
			]
		},
		{
			items: [
				{ remoteId: first, completion },
				{ remoteId: 'not-a-uuid', completion }
			]
		},
		{
			items: [
				{ remoteId: first, completion },
				{ remoteId: first.toUpperCase(), completion }
			]
		},
		{
			items: [
				{
					remoteId: first,
					completion: {
						...completion,
						verificationFacts: { contentReference: {} }
					}
				}
			]
		}
	])(
		'rejects malformed or duplicate batches atomically: %j',
		async (payload) => {
			const { post, execute } = fixture();
			await post().send(payload).expect(400);
			expect(execute).not.toHaveBeenCalled();
		}
	);
	it('uses the existing configured write-batch size as its request bound', async () => {
		const previous = process.env.HISTORY_ARCHIVE_COMPLETION_WRITE_BATCH_SIZE;
		process.env.HISTORY_ARCHIVE_COMPLETION_WRITE_BATCH_SIZE = '1';
		try {
			const { post, execute } = fixture();
			const response = await post()
				.send({
					items: [first, second].map((remoteId) => ({ remoteId, completion }))
				})
				.expect(413);
			expect(response.body.maxItems).toBe(1);
			expect(execute).not.toHaveBeenCalled();
		} finally {
			if (previous === undefined)
				delete process.env.HISTORY_ARCHIVE_COMPLETION_WRITE_BATCH_SIZE;
			else process.env.HISTORY_ARCHIVE_COMPLETION_WRITE_BATCH_SIZE = previous;
		}
	});
	it('returns per-attempt stale and retry outcomes without claiming success', async () => {
		const { post, execute } = fixture();
		execute
			.mockResolvedValueOnce(ok(false))
			.mockResolvedValueOnce(err(new Error('write unavailable')));
		const response = await post()
			.send({
				items: [first, second].map((remoteId) => ({ remoteId, completion }))
			})
			.expect(200);
		expect(
			response.body.items.map((item: { status: string }) => item.status)
		).toEqual(['stale', 'retry']);
		expect(response.body.items[1].error).toBe('write unavailable');
	});
	it('treats a thrown write failure as retry rather than losing other outcomes', async () => {
		const { post, execute } = fixture();
		execute.mockRejectedValueOnce(new Error('connection lost'));
		const response = await post()
			.send({ items: [{ remoteId: first, completion }] })
			.expect(200);
		expect(response.body.items[0]).toMatchObject({
			status: 'retry',
			remoteId: first,
			executionId,
			claimAttempt: 2
		});
	});
});

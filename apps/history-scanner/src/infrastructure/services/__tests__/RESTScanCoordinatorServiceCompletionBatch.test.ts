import { HttpError, Url, type HttpService } from 'http-helper';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { HistoryArchiveObjectCompletionItem } from '../../../domain/scan/ScanCoordinatorService.js';
import { RESTScanCoordinatorService } from '../RESTScanCoordinatorService.js';

const items: readonly HistoryArchiveObjectCompletionItem[] = [1, 2, 3].map(
	(number) => ({
		remoteId: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
		completion: {
			scheduler: 'broker',
			executionId: `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
			claimAttempt: number,
			workerStage: 'verified'
		}
	})
);
function response(status = 200, data: unknown = { items: identities() }) {
	return { status, data, headers: {}, statusText: String(status) };
}
function identities() {
	return items.map(({ remoteId, completion }) => ({
		remoteId,
		claimAttempt: completion.claimAttempt!,
		executionId: completion.executionId!,
		status: 'accepted',
		error: undefined as string | undefined
	}));
}
function setup() {
	const http = mock<HttpService>();
	return {
		http,
		service: new RESTScanCoordinatorService(
			http,
			'http://coordinator.example',
			{ type: 'internal', username: 'scanner', password: 'secret' }
		)
	};
}

describe('strict scanner completion batch transport', () => {
	it('sends one authenticated bounded-budget request and preserves accepted/stale/retry ordering', async () => {
		const { http, service } = setup();
		const rows = identities();
		rows[1]!.status = 'stale';
		rows[2]!.status = 'retry';
		rows[2]!.error = 'database unavailable';
		http.post.mockResolvedValue(ok(response(200, { items: rows })));
		const result = await service.completeHistoryArchiveObjects(items);
		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.map((item) => item.isOk())).toEqual([
			true,
			true,
			false
		]);
		expect(http.post).toHaveBeenCalledTimes(1);
		expect(http.post).toHaveBeenCalledWith(
			Url.create(
				'http://coordinator.example/v1/history-scan/archive-object-jobs/complete-batch'
			)._unsafeUnwrap(),
			{ items },
			{
				auth: { username: 'scanner', password: 'secret' },
				connectionTimeoutMs: 30_000,
				socketTimeoutMs: 30_000,
				responseType: 'json'
			}
		);
	});
	it.each([
		'remoteId',
		'executionId',
		'claimAttempt',
		'status',
		'error',
		'order',
		'missing',
		'extra',
		'notArray',
		'notObject'
	] as const)(
		'rejects the entire response before any success escapes on %s mismatch',
		async (kind) => {
			const { http, service } = setup();
			const rows = identities();
			let data: unknown = { items: rows };
			if (kind === 'remoteId') rows[2]!.remoteId = rows[0]!.remoteId;
			if (kind === 'executionId') rows[2]!.executionId = rows[0]!.executionId;
			if (kind === 'claimAttempt') rows[2]!.claimAttempt++;
			if (kind === 'status') rows[2]!.status = 'unknown';
			if (kind === 'error') Object.assign(rows[2]!, { error: 123 });
			if (kind === 'order') rows.reverse();
			if (kind === 'missing') rows.pop();
			if (kind === 'extra') rows.push(rows[0]!);
			if (kind === 'notArray') data = { items: {} };
			if (kind === 'notObject') data = null;
			http.post.mockResolvedValue(ok(response(200, data)));
			expect((await service.completeHistoryArchiveObjects(items)).isErr()).toBe(
				true
			);
			expect(http.post).toHaveBeenCalledTimes(1);
		}
	);
	it.each([404, 413])(
		'downgrades outer %s to existing single-object requests, without treating outer status as acknowledgement',
		async (status) => {
			const { http, service } = setup();
			http.post
				.mockResolvedValueOnce(ok(response(status, { maxItems: 1 })))
				.mockResolvedValueOnce(ok(response(204)))
				.mockResolvedValueOnce(ok(response(500)))
				.mockResolvedValueOnce(
					ok(response(404, { error: 'Archive object job not found' }))
				);
			const result = await service.completeHistoryArchiveObjects(items);
			if (result.isErr()) throw result.error;
			expect(result.value.map((value) => value.isOk())).toEqual([
				true,
				false,
				true
			]);
			expect(http.post).toHaveBeenCalledTimes(4);
			for (let index = 0; index < items.length; index++) {
				expect(http.post.mock.calls[index + 1]![0]).toEqual(
					Url.create(
						`http://coordinator.example/v1/history-scan/archive-object-job/${items[index]!.remoteId}/complete`
					)._unsafeUnwrap()
				);
			}
		}
	);
	it.each([404, 413])(
		'also downgrades HttpError %s once, keeping fallback HTTP concurrency at one',
		async (status) => {
			const { http, service } = setup();
			let finish:
				((value: Awaited<ReturnType<HttpService['post']>>) => void) | undefined;
			http.post
				.mockResolvedValueOnce(
					err(
						new HttpError('old or oversized route', undefined, response(status))
					)
				)
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							finish = resolve;
						})
				)
				.mockResolvedValue(ok(response(204)));
			const pending = service.completeHistoryArchiveObjects(items);
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(http.post).toHaveBeenCalledTimes(2);
			expect(finish).toBeDefined();
			finish!(ok(response(204)));
			expect((await pending).isOk()).toBe(true);
			expect(http.post).toHaveBeenCalledTimes(4);
		}
	);
	it.each([401, 500, 503])(
		'does not fan out or acknowledge outer %s',
		async (status) => {
			const { http, service } = setup();
			http.post.mockResolvedValue(ok(response(status)));
			expect((await service.completeHistoryArchiveObjects(items)).isErr()).toBe(
				true
			);
			expect(http.post).toHaveBeenCalledTimes(1);
		}
	);
	it('keeps network errors retryable without a second request', async () => {
		const { http, service } = setup();
		http.post.mockResolvedValue(err(new Error('socket timed out')));
		expect((await service.completeHistoryArchiveObjects(items)).isErr()).toBe(
			true
		);
		expect(http.post).toHaveBeenCalledTimes(1);
	});
	it('preserves legacy single-object handling and makes no request for empty input', async () => {
		const { http, service } = setup();
		expect(
			(await service.completeHistoryArchiveObjects([]))._unsafeUnwrap()
		).toEqual([]);
		expect(http.post).not.toHaveBeenCalled();
		http.post.mockResolvedValue(ok(response(204)));
		expect(
			(
				await service.completeHistoryArchiveObjects([
					{ remoteId: items[0]!.remoteId, completion: {} }
				])
			).isOk()
		).toBe(true);
		expect(http.post.mock.calls[0]![0]).toEqual(
			Url.create(
				`http://coordinator.example/v1/history-scan/archive-object-job/${items[0]!.remoteId}/complete`
			)._unsafeUnwrap()
		);
	});
});

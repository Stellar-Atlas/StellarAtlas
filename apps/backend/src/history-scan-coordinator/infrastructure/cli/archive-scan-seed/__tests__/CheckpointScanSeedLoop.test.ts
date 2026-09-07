import { runCheckpointScanSeedLoop as run } from '../CheckpointScanSeedLoop.js';
import { parseCheckpointScanSeedCliOptions as parse } from '../CheckpointScanSeedCliOptions.js';
import type { CheckpointScanSeedResult } from '../../../repositories/database/HistoryArchiveCheckpointScanSeed.js';

function progress(
	source: CheckpointScanSeedResult['source'] = 'attestations',
	complete = false
): CheckpointScanSeedResult {
	return {
		source,
		complete,
		rowsRead: 1000,
		evidenceRows: 1000,
		changedPages: 1,
		durableFloorDeficits: null,
		sources: [
			{ source: 'listings', complete: true },
			{ source: 'attestations', complete },
			{ source: 'events', complete },
			{ source: 'queue', complete }
		]
	};
}

describe('explicit until-complete checkpoint scan seed loop', () => {
	it('keeps the default finite command to one chunk', async () => {
		const next = jest.fn(async () => progress());
		const write = jest.fn();
		expect(await run(parse(['--run']), next, write, () => 0)).toEqual({
			chunksCompleted: 1,
			complete: false
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledTimes(1);
	});
	it('continues beyond 100 chunks and finite elapsed time, logging sparsely until completion', async () => {
		let count = 0;
		const next = jest.fn(async () => {
			count++;
			return progress(count <= 201 ? 'attestations' : 'events', count === 205);
		});
		const write = jest.fn();
		expect(
			await run(
				parse(['--run', '--until-complete']),
				next,
				write,
				() => count * 1000
			)
		).toEqual({ chunksCompleted: 205, complete: true });
		expect(write.mock.calls.map(([entry]) => entry.chunksCompleted)).toEqual([
			1, 100, 200, 202, 205
		]);
	});
	it('waits for each bounded transaction before requesting the next chunk', async () => {
		let finish: ((value: CheckpointScanSeedResult) => void) | undefined;
		const next = jest.fn(
			() =>
				new Promise<CheckpointScanSeedResult>((resolve) => {
					finish = resolve;
				})
		);
		const running = run(
			parse(['--run', '--until-complete']),
			next,
			jest.fn(),
			() => 0
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(next).toHaveBeenCalledTimes(1);
		finish?.(progress('queue', true));
		expect(await running).toEqual({ chunksCompleted: 1, complete: true });
	});
	it('propagates database failures without an internal retry loop', async () => {
		const error = Object.assign(new Error('statement cancelled'), {
			code: '57014'
		});
		const next = jest
			.fn()
			.mockResolvedValueOnce(progress())
			.mockRejectedValue(error);
		await expect(
			run(parse(['--run', '--until-complete']), next, jest.fn(), () => 0)
		).rejects.toBe(error);
		expect(next).toHaveBeenCalledTimes(2);
	});
	it('exits nonzero-ready when all phases are traversed but the durable floor is deficient', async () => {
		const next = jest.fn(async () => ({
			...progress(null),
			durableFloorDeficits: [
				{
					archiveUrlIdentity: 'Root',
					scannedCheckpointPositions: '1',
					durableVerifiedCheckpointProofs: '2'
				}
			]
		}));
		const write = jest.fn();
		await expect(
			run(parse(['--run', '--until-complete']), next, write, () => 0)
		).rejects.toMatchObject({ code: 'SEED_READINESS_PENDING' });
		expect(next).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledTimes(1);
	});
	it('honors finite deadlines and logs the final bounded partial result', async () => {
		let time = 0;
		const next = jest.fn(async () => {
			time += 1000;
			return progress();
		});
		const write = jest.fn();
		expect(
			await run(
				parse(['--run', '--chunks=100', '--duration-ms=2500']),
				next,
				write,
				() => time
			)
		).toEqual({ chunksCompleted: 3, complete: false });
		expect(write.mock.calls.map(([entry]) => entry.chunksCompleted)).toEqual([
			1, 3
		]);
	});
	it('preserves finite-mode no-claim behavior without spinning', async () => {
		const next = jest.fn(async () => progress(null));
		expect(
			await run(parse(['--run', '--chunks=100']), next, jest.fn(), () => 0)
		).toEqual({ chunksCompleted: 1, complete: false });
		expect(next).toHaveBeenCalledTimes(1);
	});
});

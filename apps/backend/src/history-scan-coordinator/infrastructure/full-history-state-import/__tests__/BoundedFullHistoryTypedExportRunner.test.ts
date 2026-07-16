import { createBoundedFullHistoryTypedExportRunner } from '../BoundedFullHistoryTypedExportRunner.js';
import type {
	FullHistoryTypedExportRunner,
	GoFullHistoryTypedExportRequest
} from '../GoFullHistoryTypedExportProcess.js';

const result = Object.freeze({
	recordCount: 0n,
	sourceSha256: 'a'.repeat(64)
});

describe('createBoundedFullHistoryTypedExportRunner', () => {
	it('keeps exporter subprocess work within the shared process cap', async () => {
		let active = 0;
		let maximumActive = 0;
		let started = 0;
		const releases: Array<() => void> = [];
		const runExport: FullHistoryTypedExportRunner = async () => {
			started += 1;
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await new Promise<void>((resolve) => releases.push(resolve));
			active -= 1;
			return result;
		};
		const bounded = createBoundedFullHistoryTypedExportRunner(3, 4, runExport);
		const requests = Array.from({ length: 4 }, () => bounded(request()));

		await waitUntil(() => started === 3);
		expect(maximumActive).toBe(3);
		expect(started).toBe(3);

		releases.shift()!();
		await waitUntil(() => started === 4);
		expect(maximumActive).toBe(3);

		for (const release of releases.splice(0)) release();
		await expect(Promise.all(requests)).resolves.toEqual([
			result,
			result,
			result,
			result
		]);
	});
});

function request(): GoFullHistoryTypedExportRequest {
	return {
		args: [],
		consumeOutput: () => Promise.resolve(result),
		executablePath: '/unused',
		label: 'test exporter',
		signal: new AbortController().signal,
		timeoutMilliseconds: 5_000
	};
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	throw new Error('Timed out waiting for bounded exporter state');
}

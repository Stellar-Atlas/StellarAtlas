import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { ScheduleScanJobs } from '../ScheduleScanJobs.js';
import { DataSource } from 'typeorm';

let kernel: Kernel;
jest.setTimeout(60000); // adjust if needed

beforeAll(async () => {
	kernel = await Kernel.getInstance(new ConfigMock());
});

beforeEach(async () => {
	await kernel.container
		.get(DataSource)
		.query('delete from history_archive_scan_job_queue');
});

afterAll(async () => {
	if (kernel) {
		await kernel.close();
	}
});

test('ScheduleScanJobs integration test', async () => {
	const scheduleScanJobs = kernel.container.get(ScheduleScanJobs);
	expect(scheduleScanJobs).toBeDefined();

	const result = await scheduleScanJobs.execute({
		historyArchiveUrls: ['https://example.com']
	});
	expect(result.isOk()).toBe(true);
	if (result.isErr()) fail(result.error);
	expect(result.value).toEqual({
		discoveredArchiveUrlCount: 1,
		scheduledArchiveScanJobCount: 1,
		duplicateSuppressedArchiveScanJobCount: 0,
		schedulerErrorCount: 0
	});
});

test('ScheduleScanJobs does not insert duplicate active jobs under concurrent callers', async () => {
	const scheduleScanJobs = kernel.container.get(ScheduleScanJobs);
	const dataSource = kernel.container.get(DataSource);
	const url = 'https://schedule-race.example.com/archive';

	const results = await Promise.all(
		Array.from({ length: 8 }, () =>
			scheduleScanJobs.execute({ historyArchiveUrls: [url] })
		)
	);
	const rows = (await dataSource.query(
		`
		select count(*)::int as count
		from history_archive_scan_job_queue
		where status in ('PENDING', 'TAKEN')
			and lower(regexp_replace(url, '/+$', '')) = $1
		`,
		[url]
	)) as Array<{ count: number | string }>;

	expect(results.every((result) => result.isOk())).toBe(true);
	const resultValues = results.map((result) => {
		if (result.isErr()) fail(result.error);

		return result.value;
	});
	expect(
		resultValues.reduce(
			(total, result) => total + result.scheduledArchiveScanJobCount,
			0
		)
	).toBe(1);
	expect(
		resultValues.reduce(
			(total, result) => total + result.duplicateSuppressedArchiveScanJobCount,
			0
		)
	).toBe(7);
	expect(Number(rows[0]?.count)).toBe(1);
});

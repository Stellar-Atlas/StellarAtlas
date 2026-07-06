import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import { DataSource } from 'typeorm';
import { TypeOrmScanJobRepository } from '../TypeOrmScanJobRepository.js';

jest.setTimeout(30000);

describe('TypeOrmScanJobRepository save count', () => {
	let kernel: Kernel;
	let repository: TypeOrmScanJobRepository;

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		repository = kernel.container.get<TypeOrmScanJobRepository>(
			TYPES.ScanJobRepository
		);
	});

	afterEach(async () => {
		if (kernel !== undefined) await kernel.close();
	});

	it('should report actual saved active jobs after duplicate suppression', async () => {
		const url = 'https://duplicate-save.example.com/archive';
		const savedCount = await repository.save([
			new ScanJob(url),
			new ScanJob(`${url}/`)
		]);

		const rows = (await kernel.container.get(DataSource).query(
			`
			select count(*)::int as count
			from history_archive_scan_job_queue
			where status in ('PENDING', 'TAKEN')
				and lower(regexp_replace(url, '/+$', '')) = $1
			`,
			[url]
		)) as Array<{ count: number | string }>;

		expect(savedCount).toBe(1);
		expect(Number(rows[0]?.count)).toBe(1);
	});
});

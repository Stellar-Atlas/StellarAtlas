import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readRepoFile(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('LedgerCloseMeta systemd service', () => {
	it('is autonomous, target-managed, and resource-bounded', () => {
		const service = readRepoFile(
			'ops/systemd/stellaratlas-full-history-ledger-close-meta.service'
		);
		const hostService = readRepoFile(
			'ops/systemd/host/stellaratlas-full-history-ledger-close-meta.service'
		);
		const target = readRepoFile('ops/systemd/stellaratlas.target');
		const installer = readRepoFile('setup-systemd.sh');

		expect(service).not.toContain(
			'FULL_HISTORY_LEDGER_CLOSE_META_LAST_LEDGER='
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_LEDGER_CLOSE_META_FETCH_CONCURRENCY=256'
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_LEDGER_CLOSE_META_PROCESSING_CONCURRENCY=12'
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_LEDGER_CLOSE_META_ADMISSION_ENABLED=true'
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_LEDGER_CLOSE_META_CYCLE_LEDGERS=12288'
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_LEDGER_CLOSE_META_INGRESS_BYTES_PER_SECOND=187500000'
		);
		expect(service).toContain('Restart=always');
		expect(service).toContain('CPUQuota=2400%');
		expect(service).toContain('MemoryMax=128G');
		expect(service).toContain('WantedBy=stellaratlas.target');
		expect(hostService).toContain(
			'RequiresMountsFor=/mnt/bulk/stellarbeat-data /mnt/stellaratlas-archive-spool'
		);
		expect(hostService).toContain(
			'FULL_HISTORY_LEDGER_CLOSE_META_PUBLICATION_STAGING_ROOT=/mnt/stellaratlas-archive-spool/full-history-etl'
		);
		expect(target).toContain(
			'stellaratlas-full-history-ledger-close-meta.service'
		);
		expect(installer).toContain(
			'systemctl start stellaratlas-full-history-ledger-close-meta.service'
		);
	});
});

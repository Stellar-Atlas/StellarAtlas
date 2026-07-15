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
		const target = readRepoFile('ops/systemd/stellaratlas.target');
		const installer = readRepoFile('setup-systemd.sh');

		expect(service).not.toContain(
			'FULL_HISTORY_LEDGER_CLOSE_META_LAST_LEDGER='
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_LEDGER_CLOSE_META_FETCH_CONCURRENCY=12'
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_LEDGER_CLOSE_META_PROCESSING_CONCURRENCY=4'
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_LEDGER_CLOSE_META_INGRESS_BYTES_PER_SECOND=187500000'
		);
		expect(service).toContain('Restart=always');
		expect(service).toContain('CPUQuota=800%');
		expect(service).toContain('MemoryMax=64G');
		expect(service).toContain('WantedBy=stellaratlas.target');
		expect(target).toContain(
			'stellaratlas-full-history-ledger-close-meta.service'
		);
		expect(installer).toContain(
			'systemctl start stellaratlas-full-history-ledger-close-meta.service'
		);
	});
});

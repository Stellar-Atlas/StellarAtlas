import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readRepoFile(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('LedgerCloseMeta systemd canary', () => {
	it('is finite, resource-bounded, and excluded from target boot', () => {
		const service = readRepoFile(
			'ops/systemd/stellaratlas-full-history-ledger-close-meta.service'
		);
		const target = readRepoFile('ops/systemd/stellaratlas.target');
		const installer = readRepoFile('setup-systemd.sh');

		expect(service).toContain(
			'Environment=FULL_HISTORY_LEDGER_CLOSE_META_LAST_LEDGER=66'
		);
		expect(service).toContain('Environment=FULL_HISTORY_LEDGER_CLOSE_META_FETCH_CONCURRENCY=1');
		expect(service).toContain('Environment=FULL_HISTORY_LEDGER_CLOSE_META_PROCESSING_CONCURRENCY=1');
		expect(service).toContain('Restart=no');
		expect(service).toContain('RuntimeMaxSec=30min');
		expect(service).toContain('CPUQuota=500%');
		expect(service).toContain('MemoryMax=32G');
		expect(service).not.toContain('WantedBy=stellaratlas.target');
		expect(target).not.toContain(
			'stellaratlas-full-history-ledger-close-meta.service'
		);
		expect(installer).not.toContain(
			'systemctl start stellaratlas-full-history-ledger-close-meta.service'
		);
	});
});

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const serviceName = 'stellaratlas-full-history-state-import.service';
const executable =
	'/home/observe/stellarbeat-data/Observer/apps/full-history-etl/bin/stellaratlas-full-history-state-export';
const storageRoot = '/home/observe/stellarbeat-data/full-history/typed';

describe('full-history state-import systemd service', () => {
	it('is autonomous, readiness-gated, and resource-bounded', () => {
		const service = readRepoFile(`ops/systemd/${serviceName}`);

		expect(service).toContain(`RequiresMountsFor=${storageRoot}`);
		expect(service).not.toContain('ConditionPathIsDirectory=');
		expect(service).toContain(`ConditionFileIsExecutable=${executable}`);
		expect(service).toContain(`ExecStartPre=/usr/bin/test -x ${executable}`);
		expect(service).toContain(`ExecStartPre=/usr/bin/test -d ${storageRoot}`);
		expect(service).toContain(
			'Environment=FULL_HISTORY_STATE_IMPORT_STORAGE_ROOT=' + storageRoot
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_STATE_EXPORT_EXECUTABLE=' + executable
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_STATE_IMPORT_INSERT_ROWS=250'
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_STATE_IMPORT_LEASE_MS=600000'
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_STATE_EXPORT_TIMEOUT_MS=1800000'
		);
		expect(service).toContain(
			'Environment=FULL_HISTORY_STATE_IMPORT_WORKERS=4'
		);
		expect(service).toContain('Restart=on-failure');
		expect(service).toContain('RestartSteps=5');
		expect(service).toContain('RestartMaxDelaySec=5min');
		expect(service).toContain('CPUQuota=800%');
		expect(service).toContain('MemoryMax=32G');
		expect(service).toContain('MemorySwapMax=0');
		expect(service).toContain('WantedBy=stellaratlas.target');
		expect(service).not.toContain('stellaratlas-api.service');
		expect(service).not.toContain('wait-for-url');
	});

	it('is ordered after its producer and tracked by the production target', () => {
		const target = readRepoFile('ops/systemd/stellaratlas.target');
		const installer = readRepoFile('setup-systemd.sh');
		const service = readRepoFile(`ops/systemd/${serviceName}`);
		const installBlock = installer.match(
			/INSTALL_UNIT_NAMES=\(([\s\S]*?)\n\)/
		)?.[1];

		expect(target).toMatch(
			new RegExp(`^Wants=.*${serviceName.replace('.', '\\.')}`, 'm')
		);
		expect(service).toContain(
			'After=network-online.target stellaratlas-full-history-ledger-close-meta.service'
		);
		expect(target).not.toMatch(
			new RegExp(`^After=.*${serviceName.replace('.', '\\.')}`, 'm')
		);
		expect(installBlock).toBeDefined();
		expect(installBlock?.match(new RegExp(serviceName, 'g'))).toHaveLength(1);
	});

	it('has matching backend and root package commands', () => {
		expect(readScripts('apps/backend/package.json')).toEqual(
			expect.objectContaining({
				'run-full-history-state-import':
					'node lib/history-scan-coordinator/infrastructure/cli/full-history-state-import/run-full-history-state-import.js'
			})
		);
		expect(readScripts('package.json')).toEqual(
			expect.objectContaining({
				'start:full-history-state-import':
					'pnpm --filter backend run run-full-history-state-import'
			})
		);
	});

	it('does not add a shell or public-degradation path', () => {
		const directory = join(
			process.cwd(),
			'apps/backend/src/history-scan-coordinator/infrastructure/cli/full-history-state-import'
		);
		const source = readdirSync(directory)
			.filter((name) => name.endsWith('.ts'))
			.map((name) => readFileSync(join(directory, name), 'utf8'))
			.join('\n');

		expect(source).not.toContain("from 'node:child_process'");
		expect(source).not.toContain('degraded');
	});
});

function readRepoFile(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function readScripts(relativePath: string): Readonly<Record<string, string>> {
	const parsed: unknown = JSON.parse(readRepoFile(relativePath));
	if (!isRecord(parsed) || !isRecord(parsed.scripts)) {
		throw new TypeError(`${relativePath} has no scripts object`);
	}
	const scripts: Record<string, string> = {};
	for (const [name, value] of Object.entries(parsed.scripts)) {
		if (typeof value === 'string') scripts[name] = value;
	}
	return scripts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

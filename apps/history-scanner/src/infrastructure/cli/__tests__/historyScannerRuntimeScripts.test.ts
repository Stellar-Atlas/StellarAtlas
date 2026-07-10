import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readRepoFile(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function readPackageScripts(relativePath: string): Record<string, string> {
	const packageJson: unknown = JSON.parse(readRepoFile(relativePath));
	if (!hasStringScripts(packageJson)) {
		throw new Error(`${relativePath} must define string package scripts`);
	}

	return packageJson.scripts;
}

function hasStringScripts(
	value: unknown
): value is { scripts: Record<string, string> } {
	if (typeof value !== 'object' || value === null) return false;
	if (!('scripts' in value)) return false;
	const scripts = value.scripts;
	if (typeof scripts !== 'object' || scripts === null) return false;

	return Object.values(scripts).every((script) => typeof script === 'string');
}

describe('history scanner runtime scripts', () => {
	it('routes production package scripts through the clustered scanner entrypoint', () => {
		const rootScripts = readPackageScripts('package.json');
		const scannerScripts = readPackageScripts(
			'apps/history-scanner/package.json'
		);

		expect(rootScripts['start:scan-history']).toBe(
			'pnpm --filter history-scanner run scan-history'
		);
		expect(scannerScripts['scan-history']).toBe(
			'node lib/infrastructure/cli/verify-archive-objects-cluster.js 1'
		);
		expect(scannerScripts['build-and-scan-history']).toBe(
			'pnpm run build && pnpm run scan-history'
		);
	});

	it('keeps the systemd scanner service on clustered total caps', () => {
		const service = readRepoFile(
			'ops/systemd/stellaratlas-history-scanner@.service'
		);

		expect(service).toContain('Environment=HISTORY_OBJECT_WORKER_PROCESSES=24');
		expect(service).toContain('Environment=HISTORY_SCAN_WORKERS=1');
		expect(service).toContain(
			'These are total object workers; each worker claims one archive object at a time.'
		);
		expect(service).toContain('ExecStart=/usr/bin/env pnpm start:scan-history');
		expect(service).not.toContain('verify-archives.js');
		expect(service).not.toContain('verify-archives-cluster.js');
		expect(service).not.toContain('scan-history:single');
	});

	it('installs a boot-safe history scanner unit as a target-managed instance', () => {
		const setupScript = readRepoFile('setup-systemd.sh');
		const target = readRepoFile('ops/systemd/stellaratlas.target');
		const polkitRule = readRepoFile(
			'ops/systemd/10-stellaratlas-observe.rules'
		);

		expect(setupScript).toContain('stellaratlas-history-scanner@.service');
		expect(setupScript).toContain('install_regular_file');
		expect(setupScript).not.toContain('ln -sfnT "$source" "$target"');
		expect(target).toContain(
			'RequiresMountsFor=/home/observe/stellarbeat-data/Observer'
		);
		expect(target).toContain('stellaratlas-history-scanner@1.service');
		expect(polkitRule).toContain('stellaratlas-history-scanner@1.service');
		expect(polkitRule).toContain('org.freedesktop.systemd1.reload-daemon');
	});
});

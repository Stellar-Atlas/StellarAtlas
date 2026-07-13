import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readRepoFile = (relativePath: string): string =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('network Meilisearch systemd contract', () => {
	it('runs a bounded isolated projection on the high-capacity mount', () => {
		const service = readRepoFile(
			'ops/systemd/stellaratlas-meilisearch-network.service'
		);

		expect(service).toContain('Environment=MEILI_HTTP_ADDR=127.0.0.1:7701');
		expect(service).toContain(
			'Environment=MEILI_DB_PATH=/home/observe/stellarbeat-data/meilisearch/network/data'
		);
		expect(service).toContain(
			'ConditionPathExists=/etc/stellaratlas/meilisearch-network.env'
		);
		expect(service).toContain(
			'ConditionFileIsExecutable=/home/observe/.local/bin/meilisearch'
		);
		expect(service).not.toContain('ConditionPathIsExecutable=');
		expect(service).toContain(
			'EnvironmentFile=/etc/stellaratlas/meilisearch-network.env'
		);
		expect(service).toContain('Environment=MEILI_MAX_INDEXING_THREADS=2');
		expect(service).toContain('MemoryMax=4G');
		expect(service).toContain('CPUQuota=400%');
		expect(service).toContain('TasksMax=512');
		expect(service).not.toContain(
			'MEILI_DB_PATH=/home/observe/stellarbeat-data/meilisearch/data'
		);
	});

	it('installs and orders the isolated service without embedding secrets', () => {
		const apiService = readRepoFile('ops/systemd/stellaratlas-api.service');
		const installer = readRepoFile('setup-systemd.sh');
		const polkit = readRepoFile('ops/systemd/10-stellaratlas-observe.rules');
		const target = readRepoFile('ops/systemd/stellaratlas.target');

		expect(installer).toContain('stellaratlas-meilisearch-network.service');
		expect(polkit).toContain('stellaratlas-meilisearch-network.service');
		expect(target).toContain('stellaratlas-meilisearch-network.service');
		expect(apiService).toContain(
			'After=network-online.target stellaratlas-meilisearch-network.service'
		);
		expect(apiService).toContain(
			'EnvironmentFile=-/etc/stellaratlas/meilisearch-network.env'
		);
		expect(apiService).not.toContain('MEILISEARCH_NETWORK_API_KEY=');
	});

	it('provisions private credentials and array directories idempotently', () => {
		const installer = readRepoFile('setup-systemd.sh');
		const absentFileBranch = installer.slice(
			installer.indexOf('if [[ ! -e "$NETWORK_MEILI_ENV_FILE" ]]'),
			installer.indexOf(
				'[[ -f "$NETWORK_MEILI_ENV_FILE" ]] ||',
				installer.indexOf('if [[ ! -e "$NETWORK_MEILI_ENV_FILE" ]]')
			)
		);
		const verifyOnlyBranch = installer.slice(
			installer.indexOf('--verify)'),
			installer.indexOf('--verify-installed)')
		);
		const verifyInstalledBranch = installer.slice(
			installer.indexOf('--verify-installed)'),
			installer.indexOf('--help | -h)')
		);

		expect(installer).toContain(
			'NETWORK_MEILI_ENV_FILE="$NETWORK_MEILI_ENV_DIR/meilisearch-network.env"'
		);
		expect(installer).toContain(
			'NETWORK_MEILI_DATA_ROOT="/home/observe/stellarbeat-data/meilisearch/network"'
		);
		expect(installer).toContain('master_key="$(openssl rand -hex 32)"');
		expect(installer).toContain(
			'if [[ ! -e "$NETWORK_MEILI_ENV_FILE" ]]; then'
		);
		expect(absentFileBranch).toContain(
			'printf \'MEILI_MASTER_KEY=%s\\n\' "$master_key"'
		);
		expect(absentFileBranch).toContain(
			'ln "$staged" "$NETWORK_MEILI_ENV_FILE" 2>/dev/null'
		);
		expect(installer).not.toMatch(/printf[^\n]*master_key[^\n]*>&2/);
		expect(installer).not.toMatch(/echo[^\n]*master_key/);
		expect(installer).not.toContain(
			'mv -fT "$staged" "$NETWORK_MEILI_ENV_FILE"'
		);
		expect(installer).toContain('chown root:observe "$NETWORK_MEILI_ENV_FILE"');
		expect(installer).toContain('chmod 0640 "$NETWORK_MEILI_ENV_FILE"');
		expect(installer).toContain(
			'install -d -o observe -g observe -m 0700 "$directory"'
		);
		expect(installer).toContain('"root:observe:640"');
		expect(installer).toContain('"observe:observe:700"');
		expect(verifyOnlyBranch).not.toContain(
			'provision_network_meilisearch_runtime'
		);
		expect(verifyInstalledBranch).not.toContain(
			'provision_network_meilisearch_runtime'
		);
	});
});

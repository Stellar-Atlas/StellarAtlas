import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('Core launcher preserves RPC metadata, arguments and private configuration', { skip: process.platform !== 'linux' }, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'stellaratlas-core-launcher-test-'));
	try {
		const executable = join(directory, 'core-stub');
		const wrapper = join(directory, 'launcher.sh');
		const config = join(directory, 'input.cfg');
		const originalConfig = 'BACKGROUND_OVERLAY_PROCESSING=true\nNETWORK_PASSPHRASE="isolated test"\n';
		await writeFile(config, originalConfig);
		await writeFile(executable, '#!' + process.execPath + '\n' + `
const fs = require('node:fs');
const args = process.argv.slice(2);
const index = args.indexOf('--conf');
const path = index >= 0 ? args[index + 1] : args.find(a => a.startsWith('--conf=')).slice(7);
const config = fs.readFileSync(path, 'utf8');
if (!config.startsWith('BACKGROUND_OVERLAY_PROCESSING=false\\n') || config.includes('BACKGROUND_OVERLAY_PROCESSING=true')) throw new Error('Configuration override failed');
if ((fs.statSync(path).mode & 0o777) !== 0o600) throw new Error('Configuration must be private');
if (args.at(-2) !== 'run' || args.at(-1) !== '--metadata-output-stream=fd:3') throw new Error('Arguments changed');
fs.writeSync(3, 'metadata descriptor preserved');
`);
		await chmod(executable, 0o755);
		const source = await readFile(new URL('../ops/stellar-core-main-overlay.sh', import.meta.url), 'utf8');
		const original = 'core=/mnt/bulk/stellarbeat-data/stellar-core/bin/stellar-core';
		assert.equal(source.split(original).length, 2);
		await writeFile(wrapper, source.replace(original, 'core=' + executable));
		await chmod(wrapper, 0o755);
		for (const args of [['--conf', config, 'run', '--metadata-output-stream=fd:3'], ['--conf=' + config, 'run', '--metadata-output-stream=fd:3']]) {
			const child = spawn(wrapper, args, { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
			let data = ''; let errors = '';
			child.stdio[3].on('data', chunk => { data += chunk.toString(); });
			child.stderr.on('data', chunk => { errors += chunk.toString(); });
			const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
			assert.equal(status, 0, errors);
			assert.equal(data, 'metadata descriptor preserved');
		}
		assert.equal(await readFile(config, 'utf8'), originalConfig);
	} finally {
		// Only test-owned temporary inputs and the fake executable are removed.
		await rm(directory, { recursive: true, force: true });
	}
});

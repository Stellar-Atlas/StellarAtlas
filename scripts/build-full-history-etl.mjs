import { execFileSync, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, mkdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repositoryRoot, 'apps', 'full-history-etl');
const builds = [
	{
		command: './cmd/full-history-etl',
		output: selectedOutput('FULL_HISTORY_LEDGER_CLOSE_META_EXECUTABLE', 'stellaratlas-full-history-etl')
	},
	{
		command: './cmd/full-history-state-export',
		output: selectedOutput('FULL_HISTORY_STATE_EXPORT_EXECUTABLE', 'stellaratlas-full-history-state-export')
	}
];
const toolchains = [
	join(homedir(), '.local', 'toolchains', 'go1.26.11', 'bin', 'go'),
	join(repositoryRoot, '.toolchains', 'go1.26.11', 'bin', 'go'),
	'/usr/local/go/bin/go'
];
const requestedToolchain = process.env.GO_BIN;
const goBinary = requestedToolchain === undefined ? toolchains[0]
	: toolchains.find(candidate => candidate === requestedToolchain);
if (!goBinary) throw new Error('GO_BIN must select an approved Go toolchain location');

await access(goBinary, constants.X_OK);
if (!/^go version go1\.26\.11 (?:linux|darwin|windows)\/(?:amd64|arm64)\s*$/.test(
	execFileSync(goBinary, ['version'], { encoding: 'utf8', timeout: 10_000, shell: false })
)) throw new Error('The build requires Go 1.26.11');
for (const build of builds) {
	const temporaryPath = `${build.output}.${process.pid}.tmp`;
	await mkdir(dirname(build.output), { mode: 0o755, recursive: true });
	try {
		await run(goBinary, [
			'build',
			'-trimpath',
			'-o',
			temporaryPath,
			build.command
		]);
		await chmod(temporaryPath, 0o755);
		await rename(temporaryPath, build.output);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

function selectedOutput(key, filename) {
	const output = join(sourceRoot, 'bin', filename);
	if (process.env[key] !== undefined && process.env[key] !== output) {
		throw new Error('Executable outputs must remain in the module bin directory');
	}
	return output;
}

function run(executable, args) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(executable, args, {
			shell: false,
			cwd: sourceRoot,
			env: { ...process.env, GOTOOLCHAIN: 'local' },
			stdio: 'inherit'
		});
		child.once('error', rejectPromise);
		child.once('exit', (code, signal) => {
			if (code === 0) return resolvePromise();
			rejectPromise(
				new Error(`Go build exited with ${code ?? signal ?? 'unknown status'}`)
			);
		});
	});
}

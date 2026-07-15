import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repositoryRoot, 'apps', 'full-history-etl');
const builds = [
	{
		command: './cmd/full-history-etl',
		output:
			process.env.FULL_HISTORY_LEDGER_CLOSE_META_EXECUTABLE ??
			join(sourceRoot, 'bin', 'stellaratlas-full-history-etl')
	},
	{
		command: './cmd/full-history-state-export',
		output:
			process.env.FULL_HISTORY_STATE_EXPORT_EXECUTABLE ??
			join(sourceRoot, 'bin', 'stellaratlas-full-history-state-export')
	}
];
const goBinary =
	process.env.GO_BIN ?? '/home/observe/.local/toolchains/go1.26.5/bin/go';

await access(goBinary, constants.X_OK);
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

function run(executable, args) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(executable, args, {
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

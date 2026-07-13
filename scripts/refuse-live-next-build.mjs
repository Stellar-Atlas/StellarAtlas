import { readdir, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export async function findLiveNextProcesses({
	appDirectory,
	distDirectory,
	procDirectory = '/proc',
	resolveAliases = true
}) {
	const entries = await readdir(procDirectory, { withFileTypes: true });
	const matches = [];
	const appPath = await realpath(appDirectory);
	const requestedPath = await normalizeDistPath(
		appPath,
		distDirectory,
		resolveAliases
	);

	for (const entry of entries) {
		if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;

		const processDirectory = path.join(procDirectory, entry.name);
		try {
			const [cwd, command, environment] = await Promise.all([
				readlink(path.join(processDirectory, 'cwd')),
				readFile(path.join(processDirectory, 'cmdline'), 'utf8'),
				readFile(path.join(processDirectory, 'environ'), 'utf8')
			]);
			const distValue = environment
				.split('\0')
				.find((value) => value.startsWith('NEXT_DIST_DIR='))
				?.slice('NEXT_DIST_DIR='.length);
			const nextProcess = command
				.replaceAll('\0', ' ')
				.match(/next-server|next start/);
			if (
				nextProcess &&
				path.resolve(cwd) === appPath &&
				distValue &&
				(await normalizeDistPath(cwd, distValue, resolveAliases)) === requestedPath
			) {
				matches.push(Number(entry.name));
			}
		} catch {
			// Processes can exit while /proc is being inspected.
		}
	}

	return matches.sort((left, right) => left - right);
}

async function normalizeDistPath(cwd, distDirectory, resolveAliases) {
	const absolutePath = path.resolve(cwd, distDirectory);
	return resolveAliases ? realpath(absolutePath) : absolutePath;
}

async function main() {
	const distDirectory = process.argv[2];
	if (!distDirectory) {
		throw new Error('Expected the Next.js dist directory as the first argument');
	}

	const matches = await findLiveNextProcesses({
		appDirectory: process.cwd(),
		distDirectory
	});
	if (matches.length === 0) return;

	process.stderr.write(
		`Refusing to rebuild ${distDirectory} while Next.js is serving it ` +
			`(process${matches.length === 1 ? '' : 'es'} ${matches.join(', ')}). ` +
			'Build and verify the staging output, then promote a stopped release.\n'
	);
	process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}

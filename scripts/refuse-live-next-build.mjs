import { readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export async function findLiveNextProcesses({
	appDirectory,
	distDirectory,
	procDirectory = '/proc'
}) {
	const entries = await readdir(procDirectory, { withFileTypes: true });
	const matches = [];

	await Promise.all(
		entries
			.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
			.map(async (entry) => {
				const processDirectory = path.join(procDirectory, entry.name);
				try {
					const [cwd, command, environment] = await Promise.all([
						readlink(path.join(processDirectory, 'cwd')),
						readFile(path.join(processDirectory, 'cmdline'), 'utf8'),
						readFile(path.join(processDirectory, 'environ'), 'utf8')
					]);
					const variables = new Map(
						environment
							.split('\0')
							.filter(Boolean)
							.map((entry) => {
								const separator = entry.indexOf('=');
								return [entry.slice(0, separator), entry.slice(separator + 1)];
							})
					);
					const normalizedCommand = command.replaceAll('\0', ' ');
					if (
						path.resolve(cwd) === path.resolve(appDirectory) &&
						variables.get('NEXT_DIST_DIR') === distDirectory &&
						(normalizedCommand.includes('next-server') ||
							normalizedCommand.includes('next start'))
					) {
						matches.push(Number(entry.name));
					}
				} catch {
					// Processes can exit while /proc is being inspected.
				}
			})
	);

	return matches.sort((left, right) => left - right);
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

	console.error(
		`Refusing to rebuild ${distDirectory} while Next.js is serving it ` +
			`(process${matches.length === 1 ? '' : 'es'} ${matches.join(', ')}). ` +
			'Build and verify the staging output, then promote a stopped release.'
	);
	process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}

import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveAppEnvPath(
	moduleUrl: string,
	appDirectoryName: string
): string {
	const moduleDirectory = dirname(fileURLToPath(moduleUrl));
	const appRoot = findAncestorDirectory(moduleDirectory, appDirectoryName);

	if (appRoot !== null) {
		return resolve(appRoot, '.env');
	}

	const cwdAppEnvPath = resolve(process.cwd(), 'apps', appDirectoryName, '.env');

	if (existsSync(cwdAppEnvPath)) {
		return cwdAppEnvPath;
	}

	return resolve(process.cwd(), '.env');
}

function findAncestorDirectory(
	startDirectory: string,
	targetDirectoryName: string
): string | null {
	let directory = startDirectory;

	while (true) {
		if (basename(directory) === targetDirectoryName) {
			return directory;
		}

		const parentDirectory = dirname(directory);
		if (parentDirectory === directory) return null;
		directory = parentDirectory;
	}
}

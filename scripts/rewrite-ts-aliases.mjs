import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootTsconfigPath = path.join(repoRoot, 'tsconfig.json');

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

function getProjects() {
	const requestedProjects = process.argv.slice(2);
	if (requestedProjects.length > 0) return requestedProjects;

	const rootTsconfig = readJson(rootTsconfigPath);
	return rootTsconfig.references.map((reference) => reference.path);
}

function resolveTsconfig(projectPath) {
	const absoluteProjectPath = path.resolve(repoRoot, projectPath);
	if (absoluteProjectPath.endsWith('.json')) return absoluteProjectPath;

	return path.join(absoluteProjectPath, 'tsconfig.json');
}

const tscAliasBin = process.platform === 'win32' ? 'tsc-alias.cmd' : 'tsc-alias';

for (const projectPath of getProjects()) {
	const tsconfigPath = resolveTsconfig(projectPath);
	if (!existsSync(tsconfigPath)) {
		console.warn(`Skipping ${projectPath}: no tsconfig.json found`);
		continue;
	}

	const tsconfig = readJson(tsconfigPath);
	if (tsconfig.compilerOptions?.noEmit === true) continue;

	const result = spawnSync(tscAliasBin, ['-p', tsconfigPath], {
		cwd: repoRoot,
		stdio: 'inherit',
		shell: process.platform === 'win32'
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

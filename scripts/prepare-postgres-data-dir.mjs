import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';

const [dataDirectory, socketPath] = process.argv.slice(2);
if (dataDirectory === undefined || socketPath === undefined) {
	throw new Error('PostgreSQL data directory and socket path are required');
}

const resolvedDataDirectory = resolve(dataDirectory);
const resolvedSocketPath = resolve(socketPath);
assertSafeSocketPath(resolvedDataDirectory, resolvedSocketPath);

if (await hasExpectedPostgres(resolvedDataDirectory)) process.exit(0);
if (await hasExpectedPostgres(resolvedDataDirectory)) process.exit(0);

const artifacts = [
	{ kind: 'pid', path: resolve(resolvedDataDirectory, 'postmaster.pid') },
	{ kind: 'socket', path: resolvedSocketPath },
	{ kind: 'lock', path: `${resolvedSocketPath}.lock` }
];

for (const artifact of artifacts) {
	if (await removeStaleArtifact(artifact.path, artifact.kind)) {
		console.log(`Removed stale PostgreSQL ${artifact.kind} artifact`);
	}
}

async function hasExpectedPostgres(expectedDataDirectory) {
	const entries = await readdir('/proc', { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory() || !/^[1-9][0-9]*$/.test(entry.name)) continue;
		const commandLine = await readProcessCommandLine(entry.name);
		if (commandLine === null || basename(commandLine[0] ?? '') !== 'postgres') {
			continue;
		}
		const dataFlag = commandLine.indexOf('-D');
		const processDataDirectory = commandLine[dataFlag + 1];
		if (
			dataFlag >= 0 &&
			processDataDirectory !== undefined &&
			resolve(processDataDirectory) === expectedDataDirectory
		) {
			return true;
		}
	}
	return false;
}

async function readProcessCommandLine(pid) {
	try {
		return (await readFile(`/proc/${pid}/cmdline`))
			.toString('utf8')
			.split('\0')
			.filter(Boolean);
	} catch (error) {
		if (isMissingOrInaccessible(error)) return null;
		throw error;
	}
}

async function removeStaleArtifact(path, kind) {
	try {
		const stats = await lstat(path);
		const validType =
			(kind === 'socket' && stats.isSocket()) ||
			(kind !== 'socket' && stats.isFile());
		if (!validType)
			throw new Error(`Refusing to remove unexpected ${kind} type`);
		await rm(path);
		return true;
	} catch (error) {
		if (isMissingFile(error)) return false;
		throw error;
	}
}

function assertSafeSocketPath(expectedDataDirectory, candidateSocketPath) {
	const socketName = basename(candidateSocketPath);
	if (
		!candidateSocketPath.startsWith(`${expectedDataDirectory}${sep}`) ||
		!/^\.s\.PGSQL\.[1-9][0-9]*$/.test(socketName)
	) {
		throw new Error('PostgreSQL socket path is outside the expected data tree');
	}
}

function isMissingFile(error) {
	return hasErrorCode(error, 'ENOENT');
}

function isMissingOrInaccessible(error) {
	return isMissingFile(error) || hasErrorCode(error, 'EACCES');
}

function hasErrorCode(error, code) {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === code
	);
}

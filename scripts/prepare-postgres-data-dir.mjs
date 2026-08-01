import { readFile, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const dataDirectory = process.argv[2];
if (dataDirectory === undefined) {
	throw new Error('PostgreSQL data directory is required');
}

const resolvedDataDirectory = resolve(dataDirectory);
const pidPath = resolve(resolvedDataDirectory, 'postmaster.pid');
const recordedPid = await readRecordedPid(pidPath);
if (recordedPid === null) process.exit(0);

if (await isExpectedPostgres(recordedPid, resolvedDataDirectory)) {
	process.exit(0);
}

const currentPid = await readRecordedPid(pidPath);
if (currentPid !== recordedPid) {
	throw new Error('PostgreSQL PID file changed during stale-lock inspection');
}

await rm(pidPath);
console.log(`Removed stale PostgreSQL PID file for ${resolvedDataDirectory}`);

async function readRecordedPid(path) {
	try {
		const [line] = (await readFile(path, 'utf8')).split('\n');
		if (line === undefined || !/^[1-9][0-9]*$/.test(line)) {
			throw new Error(`Invalid PostgreSQL PID file: ${path}`);
		}
		return Number(line);
	} catch (error) {
		if (isMissingFile(error)) return null;
		throw error;
	}
}

async function isExpectedPostgres(pid, expectedDataDirectory) {
	try {
		const commandLine = (await readFile(`/proc/${pid}/cmdline`))
			.toString('utf8')
			.split('\0')
			.filter(Boolean);
		const executable = commandLine[0];
		if (executable === undefined || basename(executable) !== 'postgres') {
			return false;
		}
		const dataFlag = commandLine.indexOf('-D');
		const processDataDirectory = commandLine[dataFlag + 1];
		return (
			dataFlag >= 0 &&
			processDataDirectory !== undefined &&
			resolve(processDataDirectory) === expectedDataDirectory
		);
	} catch (error) {
		if (isMissingFile(error)) return false;
		throw error;
	}
}

function isMissingFile(error) {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === 'ENOENT'
	);
}

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import {
	createWriteStream,
	existsSync,
	readFileSync,
	unlinkSync
} from 'node:fs';
import type { Readable } from 'node:stream';

const apiReadyMessage = 'api listening on port:';
const apiLogFile = 'api.log';
const defaultHistoryScanWorkers = 4;
const maxHistoryScanWorkers = 16;
const apiStartTimeoutMs = 120_000;

type ManagedProcess = {
	name: string;
	process: ChildProcessByStdio<null, Readable, Readable>;
};

function parseWorkerCount(value: string | undefined): number {
	if (value === undefined || value.trim() === '')
		return defaultHistoryScanWorkers;

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) return defaultHistoryScanWorkers;

	return Math.min(parsed, maxHistoryScanWorkers);
}

function frontendV4PreviewEnabled(): boolean {
	if (process.env.DISABLE_FRONTEND_V4_PREVIEW === '1') return false;
	return process.env.ENABLE_FRONTEND_V4_PREVIEW !== '0';
}

function createProcess(name: string, args: string[]): ManagedProcess {
	const childProcess = spawn('pnpm', args, {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: process.env
	});

	childProcess.stdout.on('data', (data: Buffer) => {
		writePrefixedOutput(name, data, process.stdout);
	});

	childProcess.stderr.on('data', (data: Buffer) => {
		writePrefixedOutput(name, data, process.stderr);
	});

	return { name, process: childProcess };
}

function writePrefixedOutput(
	name: string,
	data: Buffer,
	stream: NodeJS.WriteStream
): void {
	const text = data.toString();
	for (const line of text.split(/\r?\n/)) {
		if (line.length > 0) stream.write(`[${name}] ${line}\n`);
	}
}

function waitForApi(processes: ManagedProcess[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		const interval = setInterval(() => {
			if (Date.now() - startedAt > apiStartTimeoutMs) {
				clearInterval(interval);
				stopProcesses(processes);
				reject(new Error('API did not become ready before timeout'));
				return;
			}

			if (
				existsSync(apiLogFile) &&
				readFileSync(apiLogFile, 'utf8').includes(apiReadyMessage)
			) {
				clearInterval(interval);
				resolve();
			}
		}, 1000);
	});
}

function stopProcesses(processes: ManagedProcess[]): void {
	for (const managedProcess of processes) {
		if (!managedProcess.process.killed) managedProcess.process.kill('SIGTERM');
	}
}

function watchProcessExit(
	processes: ManagedProcess[],
	managedProcess: ManagedProcess
): void {
	managedProcess.process.on('exit', (code, signal) => {
		stopProcesses(processes.filter((process) => process !== managedProcess));
		const exitCode = code ?? (signal === null ? 1 : 0);
		process.exit(exitCode);
	});
}

async function main(): Promise<void> {
	if (existsSync(apiLogFile)) unlinkSync(apiLogFile);

	const processes: ManagedProcess[] = [];
	const api = createProcess('api', ['start:api']);
	processes.push(api);

	const apiLog = createWriteStream(apiLogFile, { flags: 'a' });
	api.process.stdout.on('data', (data: Buffer) => {
		apiLog.write(data);
	});
	api.process.stderr.on('data', (data: Buffer) => {
		apiLog.write(data);
	});

	console.log('Waiting for API to be ready...');
	await waitForApi(processes);

	const historyScanWorkers = parseWorkerCount(process.env.HISTORY_SCAN_WORKERS);
	console.log(`API is up. Starting ${historyScanWorkers} history scanner(s).`);

	const serviceProcesses = [
		createProcess('frontend', ['start:frontend']),
		createProcess('network', ['start:scan-network', '1']),
		createProcess('users', ['start:users'])
	];

	if (frontendV4PreviewEnabled()) {
		console.log('Frontend v4 preview enabled at /new-ui.');
		serviceProcesses.push(createProcess('frontend-v4', ['start:frontend-v4']));
	}

	for (let index = 1; index <= historyScanWorkers; index += 1) {
		serviceProcesses.push(
			createProcess(`history-${index}`, ['start:scan-history'])
		);
	}

	processes.push(...serviceProcesses);
	for (const managedProcess of processes)
		watchProcessExit(processes, managedProcess);

	process.on('SIGTERM', () => {
		stopProcesses(processes);
	});

	process.on('SIGINT', () => {
		stopProcesses(processes);
	});
}

main().catch((error: Error) => {
	console.error(error.message);
	process.exit(1);
});

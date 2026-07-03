import { spawn, type ChildProcessByStdio } from 'node:child_process';
import {
	createWriteStream,
	existsSync,
	readFileSync,
	unlinkSync
} from 'node:fs';
import { availableParallelism } from 'node:os';
import type { Readable } from 'node:stream';

const apiReadyMessage = 'api listening on port:';
const apiLogFile = 'api.log';
const historyScanEnabledEnv = 'ENABLE_HISTORY_SCANNER';
const historyScanWorkersEnv = 'HISTORY_SCAN_WORKERS';
const defaultHistoryScanWorkers = 1;
const maxHistoryScanWorkers = 1;
const apiStartTimeoutMs = 120_000;
const frontendV4StartTimeoutMs = 120_000;

type ProcessExitListener = (
	code: number | null,
	signal: NodeJS.Signals | null
) => void;

type ManagedProcess = {
	name: string;
	process: ChildProcessByStdio<null, Readable, Readable>;
};

class StartupExitError extends Error {}

function calculateDefaultHistoryScanWorkers(cpuCount: number): number {
	if (cpuCount < defaultHistoryScanWorkers) return Math.max(cpuCount, 1);
	return defaultHistoryScanWorkers;
}

function parseWorkerCount(value: string | undefined): number {
	if (!historyScanEnabled()) return 0;

	if (value === undefined || value.trim() === '')
		return calculateDefaultHistoryScanWorkers(availableParallelism());

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1)
		return calculateDefaultHistoryScanWorkers(availableParallelism());

	return Math.min(parsed, maxHistoryScanWorkers);
}

function historyScanEnabled(): boolean {
	return process.env[historyScanEnabledEnv] !== '0';
}

function frontendV4PreviewEnabled(): boolean {
	if (process.env.DISABLE_FRONTEND_V4_PREVIEW === '1') return false;
	return process.env.ENABLE_FRONTEND_V4_PREVIEW !== '0';
}

function getFrontendV4Origin(): string {
	return process.env.FRONTEND_V4_ORIGIN ?? 'http://127.0.0.1:3104';
}

function createProcess(
	name: string,
	args: string[],
	envOverrides: NodeJS.ProcessEnv = {}
): ManagedProcess {
	const childProcess = spawn('pnpm', args, {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			...envOverrides
		}
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

function getProcessExitText(
	code: number | null,
	signal: NodeJS.Signals | null
): string {
	if (code !== null) return ` with code ${code}`;
	if (signal !== null) return ` from signal ${signal}`;
	return '';
}

function createStartupExitWaiter(managedProcess: ManagedProcess): {
	dispose: () => void;
	promise: Promise<never>;
} {
	let listener: ProcessExitListener | undefined;
	const promise = new Promise<never>((_, reject) => {
		listener = (code, signal) => {
			reject(
				new StartupExitError(
					`${managedProcess.name} exited before becoming ready${getProcessExitText(
						code,
						signal
					)}`
				)
			);
		};
		managedProcess.process.once('exit', listener);
	});

	return {
		dispose: () => {
			if (listener !== undefined)
				managedProcess.process.off('exit', listener);
		},
		promise
	};
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForApi(
	processes: ManagedProcess[],
	api: ManagedProcess
): Promise<void> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		const exitWaiter = createStartupExitWaiter(api);
		let interval: ReturnType<typeof setInterval> | undefined;
		let settled = false;

		const cleanup = () => {
			if (interval !== undefined) clearInterval(interval);
			exitWaiter.dispose();
		};

		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			stopProcesses(processes);
			reject(error);
		};

		const succeed = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve();
		};

		exitWaiter.promise.catch(fail);

		const checkReady = () => {
			if (Date.now() - startedAt > apiStartTimeoutMs) {
				fail(new Error('API did not become ready before timeout'));
				return;
			}

			if (
				existsSync(apiLogFile) &&
				readFileSync(apiLogFile, 'utf8').includes(apiReadyMessage)
			) {
				succeed();
			}
		};

		interval = setInterval(checkReady, 1000);
		checkReady();
	});
}

async function waitForHttpService(
	processes: ManagedProcess[],
	managedProcess: ManagedProcess,
	url: string,
	timeoutMs: number,
	serviceName: string
): Promise<void> {
	const startedAt = Date.now();
	const exitWaiter = createStartupExitWaiter(managedProcess);

	try {
		while (Date.now() - startedAt <= timeoutMs) {
			try {
				const response = await Promise.race([
					fetch(url, { method: 'HEAD' }),
					exitWaiter.promise
				]);
				if (response.status < 500) return;
			} catch (error) {
				if (error instanceof StartupExitError) throw error;
				// Retry until the managed service opens its listener.
			}

			await Promise.race([delay(1000), exitWaiter.promise]);
		}

		throw new Error(`${serviceName} did not become ready before timeout`);
	} catch (error) {
		stopProcesses(processes);
		throw error;
	} finally {
		exitWaiter.dispose();
	}
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
	await waitForApi(processes, api);

	const historyScanWorkers = parseWorkerCount(
		process.env[historyScanWorkersEnv]
	);
	console.log(
		historyScanWorkers === 0
			? `API is up. History scanner startup is disabled. Set ${historyScanEnabledEnv}=1 to enable it.`
			: `API is up. Starting ${historyScanWorkers} history scanner(s).`
	);

	const serviceProcesses: ManagedProcess[] = [];

	if (frontendV4PreviewEnabled()) {
		console.log('Frontend v4 service enabled.');
		const frontendV4 = createProcess('frontend-v4', ['start:frontend-v4']);
		processes.push(frontendV4);
		console.log('Waiting for frontend v4 to be ready...');
		await waitForHttpService(
			processes,
			frontendV4,
			getFrontendV4Origin(),
			frontendV4StartTimeoutMs,
			'Frontend v4'
		);
		console.log('Frontend v4 is up.');
	}

	serviceProcesses.push(
		createProcess('frontend', ['start:frontend']),
		createProcess('network', ['start:scan-network', '1']),
		createProcess('users', ['start:users'])
	);

	if (historyScanWorkers > 0) {
		for (let index = 1; index <= historyScanWorkers; index += 1) {
			serviceProcesses.push(
				createProcess(`history-${index}`, ['start:scan-history'], {
					[historyScanWorkersEnv]: historyScanWorkers.toString()
				})
			);
		}
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

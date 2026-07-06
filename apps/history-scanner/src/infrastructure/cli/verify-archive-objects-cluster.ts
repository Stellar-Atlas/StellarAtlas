import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import process from 'node:process';
import {
	isMainModule,
	parseVerifyArchiveObjectsCliOptions,
	runVerifyArchiveObjects
} from './verify-archive-objects-runner.js';

const defaultObjectWorkerProcesses = 24;
const defaultTotalHasherWorkers = 24;
const maxObjectHasherWorkers = 24;
const maxObjectWorkerProcesses = 24;
const startupJitterStepMs = 100;
const maxStartupJitterMs = 2_500;
const shutdownTimeoutMs = 30_000;

export interface HistoryArchiveObjectClusterPlan {
	readonly perProcessHasherWorkers: number;
	readonly processCount: number;
	readonly totalHasherWorkers: number;
}

export function createHistoryArchiveObjectClusterPlan(
	env: NodeJS.ProcessEnv,
	cpuCount = availableParallelism()
): HistoryArchiveObjectClusterPlan {
	const processCount = readBoundedPositiveInteger(
		env,
		'HISTORY_OBJECT_WORKER_PROCESSES',
		Math.min(defaultObjectWorkerProcesses, Math.max(cpuCount - 1, 1)),
		maxObjectWorkerProcesses
	);
	const totalHasherWorkers = readBoundedPositiveInteger(
		env,
		'HISTORY_HASHER_WORKERS',
		Math.min(defaultTotalHasherWorkers, Math.max(cpuCount - 1, 1)),
		maxObjectHasherWorkers
	);

	return {
		perProcessHasherWorkers: Math.max(
			Math.floor(totalHasherWorkers / processCount),
			1
		),
		processCount,
		totalHasherWorkers
	};
}

export async function runHistoryArchiveObjectCluster(
	args: readonly string[],
	env: NodeJS.ProcessEnv = process.env
): Promise<void> {
	if (!cluster.isPrimary) {
		await waitForWorkerStartupJitter(env);
		await runVerifyArchiveObjects(parseVerifyArchiveObjectsCliOptions(args));
		return;
	}

	const plan = createHistoryArchiveObjectClusterPlan(env);
	let shuttingDown = false;
	let nextWorkerIndex = 0;

	const forkWorker = (): void => {
		const workerIndex = nextWorkerIndex;
		nextWorkerIndex = (nextWorkerIndex + 1) % plan.processCount;
		cluster.fork({
			...env,
			HISTORY_HASHER_WORKERS: String(plan.perProcessHasherWorkers),
			HISTORY_OBJECT_WORKER_INDEX: String(workerIndex),
			HISTORY_OBJECT_WORKER_PROCESS_COUNT: String(plan.processCount),
			HISTORY_SCAN_WORKERS: '1'
		});
	};

	for (let index = 0; index < plan.processCount; index++) forkWorker();

	cluster.on('exit', (_worker, code) => {
		if (shuttingDown) return;
		if (code === 0) return;
		forkWorker();
	});

	const stop = (): void => {
		if (shuttingDown) return;
		shuttingDown = true;
		for (const worker of Object.values(cluster.workers ?? {})) {
			worker?.process.kill('SIGTERM');
		}
		setTimeout(() => {
			for (const worker of Object.values(cluster.workers ?? {})) {
				worker?.kill();
			}
			process.exit(0);
		}, shutdownTimeoutMs).unref();
	};

	process.on('SIGTERM', stop).on('SIGINT', stop);
}

async function waitForWorkerStartupJitter(env: NodeJS.ProcessEnv): Promise<void> {
	const workerIndex = readOptionalNonNegativeInteger(
		env,
		'HISTORY_OBJECT_WORKER_INDEX'
	);
	if (workerIndex === undefined) return;

	const delayMs = Math.min(workerIndex * startupJitterStepMs, maxStartupJitterMs);
	if (delayMs === 0) return;
	await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function readBoundedPositiveInteger(
	env: NodeJS.ProcessEnv,
	name: string,
	defaultValue: number,
	maximum: number
): number {
	const rawValue = env[name];
	if (rawValue === undefined || rawValue.trim() === '') return defaultValue;

	const parsed = Number(rawValue);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
		throw new Error(`${name} must be between 1 and ${maximum}`);
	}

	return parsed;
}

function readOptionalNonNegativeInteger(
	env: NodeJS.ProcessEnv,
	name: string
): number | undefined {
	const rawValue = env[name];
	if (rawValue === undefined || rawValue.trim() === '') return undefined;

	const parsed = Number(rawValue);
	if (!Number.isInteger(parsed) || parsed < 0) return undefined;
	return parsed;
}

if (isMainModule(import.meta.url)) {
	void runHistoryArchiveObjectCluster(process.argv.slice(2));
}

import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import process from 'node:process';
import {
	isMainModule,
	parseVerifyArchivesCliOptions,
	runVerifyArchives
} from './verify-archives-runner.js';

const defaultTotalRequests = 24;
const defaultHistoryScanProcesses = 12;
const defaultHistoryHasherWorkers = 24;
const maxHistoryScanProcesses = 24;
const maxHistoryHasherWorkers = 24;
const maxHistoryRequests = 24;
const shutdownTimeoutMs = 30_000;

export interface HistoryScanClusterPlan {
	readonly perProcessHasherWorkers: number;
	readonly perProcessRequests: number;
	readonly processCount: number;
	readonly totalHasherWorkers: number;
	readonly totalRequests: number;
}

export function createHistoryScanClusterPlan(
	env: NodeJS.ProcessEnv,
	cpuCount = availableParallelism()
): HistoryScanClusterPlan {
	const totalRequests = readBoundedPositiveInteger(
		env,
		'HISTORY_MAX_REQUESTS',
		defaultTotalRequests,
		maxHistoryRequests
	);
	const totalHasherWorkers = readBoundedPositiveInteger(
		env,
		'HISTORY_HASHER_WORKERS',
		Math.min(defaultHistoryHasherWorkers, Math.max(cpuCount - 1, 1)),
		maxHistoryHasherWorkers
	);
	const requestedProcesses = readBoundedPositiveInteger(
		env,
		'HISTORY_SCAN_PROCESSES',
		Math.min(defaultHistoryScanProcesses, Math.max(cpuCount - 1, 1)),
		maxHistoryScanProcesses
	);
	const processCount = Math.min(
		requestedProcesses,
		totalRequests,
		totalHasherWorkers
	);

	return {
		perProcessHasherWorkers: Math.max(
			Math.floor(totalHasherWorkers / processCount),
			1
		),
		perProcessRequests: Math.max(Math.floor(totalRequests / processCount), 1),
		processCount,
		totalHasherWorkers,
		totalRequests
	};
}

export async function runHistoryScanCluster(
	args: readonly string[],
	env: NodeJS.ProcessEnv = process.env
): Promise<void> {
	if (!cluster.isPrimary) {
		await runVerifyArchives(parseVerifyArchivesCliOptions(args));
		return;
	}

	const plan = createHistoryScanClusterPlan(env);
	let shuttingDown = false;
	let nextWorkerIndex = 0;

	const forkWorker = (): void => {
		const workerIndex = nextWorkerIndex;
		nextWorkerIndex = (nextWorkerIndex + 1) % plan.processCount;
		cluster.fork({
			...env,
			HISTORY_HASHER_WORKERS: String(plan.perProcessHasherWorkers),
			HISTORY_MAX_REQUESTS: String(plan.perProcessRequests),
			HISTORY_SCAN_PROCESS_COUNT: String(plan.processCount),
			HISTORY_SCAN_PROCESS_INDEX: String(workerIndex),
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

if (isMainModule(import.meta.url)) {
	void runHistoryScanCluster(process.argv.slice(2));
}

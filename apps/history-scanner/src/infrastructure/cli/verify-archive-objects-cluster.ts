import cluster from 'node:cluster';
import process from 'node:process';
import {
	createHistoryArchiveObjectClusterPlan,
	HistoryArchiveObjectClusterSupervisor
} from './HistoryArchiveObjectClusterSupervisor.js';
import {
	isMainModule,
	parseVerifyArchiveObjectsCliOptions,
	runVerifyArchiveObjects
} from './verify-archive-objects-runner.js';

const startupJitterStepMs = 100;
const maxStartupJitterMs = 2_500;
const shutdownTimeoutMs = 30_000;

export {
	createHistoryArchiveObjectClusterPlan,
	HistoryArchiveObjectClusterSupervisor
};

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
	const supervisor = new HistoryArchiveObjectClusterSupervisor(
		plan,
		env,
		(workerEnv) => cluster.fork(workerEnv)
	);
	supervisor.start();

	cluster.on('exit', (worker) => {
		if (shuttingDown) return;
		supervisor.replace(worker.id);
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

async function waitForWorkerStartupJitter(
	env: NodeJS.ProcessEnv
): Promise<void> {
	const workerIndex = readOptionalNonNegativeInteger(
		env,
		'HISTORY_OBJECT_WORKER_INDEX'
	);
	if (workerIndex === undefined) return;

	const delayMs = Math.min(
		workerIndex * startupJitterStepMs,
		maxStartupJitterMs
	);
	if (delayMs === 0) return;
	await new Promise((resolve) => setTimeout(resolve, delayMs));
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

import cluster from 'node:cluster';
import process from 'node:process';
import { config as loadEnv } from 'dotenv';
import { resolveAppEnvPath } from 'shared/lib/env/resolve-app-env-path.js';
import {
	apiWorkerRestartDelayMs,
	parseApiWorkerCount,
	shouldRestartApiWorker
} from './ApiClusterPolicy.js';

const shutdownTimeoutMs = 30_000;
type ShutdownSignal = 'SIGINT' | 'SIGTERM';

if (cluster.isPrimary) {
	runPrimary();
} else {
	void runWorker();
}

function runPrimary(): void {
	loadEnv({
		path: resolveAppEnvPath(import.meta.url, 'backend'),
		quiet: true
	});

	let workerCount: number;
	try {
		workerCount = parseApiWorkerCount(process.env.API_WORKERS);
	} catch (error: unknown) {
		console.error(
			'[api-cluster] invalid worker configuration:',
			error instanceof Error ? error.message : error
		);
		process.exitCode = 1;
		return;
	}

	let shutdownStarted = false;
	let shutdownTimer: NodeJS.Timeout | undefined;
	const liveWorkerIds = new Set<number>();
	const projectionWriterByWorkerId = new Map<number, boolean>();
	const replacementTimers = new Set<NodeJS.Timeout>();

	const forkWorker = (projectionWriter: boolean): void => {
		if (shutdownStarted) return;
		const worker = cluster.fork({
			API_SEARCH_PROJECTION_WRITER: projectionWriter ? 'true' : 'false'
		});
		liveWorkerIds.add(worker.id);
		projectionWriterByWorkerId.set(worker.id, projectionWriter);
	};

	const finishShutdownIfDrained = (): void => {
		if (!shutdownStarted || liveWorkerIds.size > 0) return;
		if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
		console.log('[api-cluster] all API workers stopped');
		process.exit(0);
	};

	cluster.on('exit', (worker, code, signal) => {
		liveWorkerIds.delete(worker.id);
		const projectionWriter = projectionWriterByWorkerId.get(worker.id) ?? false;
		projectionWriterByWorkerId.delete(worker.id);

		if (
			!shouldRestartApiWorker({
				exitedAfterDisconnect: worker.exitedAfterDisconnect,
				shutdownStarted
			})
		) {
			finishShutdownIfDrained();
			return;
		}

		console.error(
			`[api-cluster] worker ${worker.process.pid ?? worker.id} exited ` +
				`(code=${code}, signal=${signal || 'none'}); scheduling replacement`
		);
		const replacementTimer = setTimeout(() => {
			replacementTimers.delete(replacementTimer);
			forkWorker(projectionWriter);
		}, apiWorkerRestartDelayMs);
		replacementTimers.add(replacementTimer);
	});

	const startShutdown = (signal: ShutdownSignal): void => {
		if (shutdownStarted) return;
		shutdownStarted = true;

		for (const timer of replacementTimers) clearTimeout(timer);
		replacementTimers.clear();

		console.log(`[api-cluster] ${signal} received; stopping API workers`);
		shutdownTimer = setTimeout(() => {
			console.error(
				'[api-cluster] graceful shutdown timed out; killing workers'
			);
			for (const worker of Object.values(cluster.workers ?? {})) {
				worker?.process.kill('SIGKILL');
			}
			process.exit(1);
		}, shutdownTimeoutMs);
		shutdownTimer.unref();

		for (const worker of Object.values(cluster.workers ?? {})) {
			worker?.process.kill(signal);
		}
		finishShutdownIfDrained();
	};

	process.once('SIGTERM', () => startShutdown('SIGTERM'));
	process.once('SIGINT', () => startShutdown('SIGINT'));

	console.log(
		`[api-cluster] primary ${process.pid} starting ${workerCount} API workers`
	);
	for (let index = 0; index < workerCount; index++) forkWorker(index === 0);
}

async function runWorker(): Promise<void> {
	try {
		await import('./api.js');
	} catch (error: unknown) {
		console.error('[api-cluster] API worker failed to load', error);
		process.exitCode = 1;
	}
}

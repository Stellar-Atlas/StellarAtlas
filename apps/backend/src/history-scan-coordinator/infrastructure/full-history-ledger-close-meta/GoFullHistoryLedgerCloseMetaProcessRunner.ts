import { spawn } from 'node:child_process';

const maximumStdoutBytes = 1 << 20;
const maximumStderrBytes = 64 << 10;
export const FULL_HISTORY_ETL_TERMINATION_GRACE_MILLISECONDS = 5_000;

export function runBoundedGoFullHistoryProcess(
	executablePath: string,
	args: readonly string[],
	timeoutMilliseconds: number,
	signal: AbortSignal
): Promise<Buffer> {
	if (signal.aborted) return Promise.reject(abortFailure(signal));
	return new Promise((resolvePromise, rejectPromise) => {
		let child: ReturnType<typeof spawnFullHistoryEtl>;
		try {
			child = spawnFullHistoryEtl(executablePath, args);
		} catch (error) {
			rejectPromise(processFailure(error, 'Full-history ETL failed to spawn'));
			return;
		}
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let overflow: Error | null = null;
		let childFailure: Error | null = null;
		let closed = false;
		let settled = false;
		let spawned = false;
		let terminationFailure: Error | null = null;
		let terminationTimer: NodeJS.Timeout | null = null;
		let timeoutTimer: NodeJS.Timeout | null = null;

		const clearLifecycle = (): void => {
			signal.removeEventListener('abort', onAbort);
			child.off('error', onChildError);
			if (terminationTimer !== null) clearTimeout(terminationTimer);
			if (timeoutTimer !== null) clearTimeout(timeoutTimer);
		};
		const rejectOnce = (error: Error): void => {
			if (settled) return;
			settled = true;
			clearLifecycle();
			rejectPromise(error);
		};
		const signalChild = (processSignal: NodeJS.Signals): void => {
			try {
				child.kill(processSignal);
			} catch (error) {
				childFailure ??= processFailure(
					error,
					`Full-history ETL could not receive ${processSignal}`
				);
			}
		};
		const terminateGracefully = (failure: Error): void => {
			if (closed || terminationFailure !== null || overflow !== null) return;
			terminationFailure = failure;
			if (timeoutTimer !== null) {
				clearTimeout(timeoutTimer);
				timeoutTimer = null;
			}
			signalChild('SIGTERM');
			terminationTimer = setTimeout(() => {
				terminationTimer = null;
				if (!closed) signalChild('SIGKILL');
			}, FULL_HISTORY_ETL_TERMINATION_GRACE_MILLISECONDS);
			terminationTimer.unref();
		};
		function onAbort(): void {
			terminateGracefully(abortFailure(signal));
		}
		function onChildError(error: Error): void {
			const failure = processFailure(
				error,
				'Full-history ETL child process failed'
			);
			if (!spawned) {
				rejectOnce(failure);
				return;
			}
			childFailure ??= failure;
		}

		child.stdout.on('data', (chunk: Buffer) => {
			stdoutBytes += chunk.byteLength;
			if (stdoutBytes > maximumStdoutBytes) {
				if (overflow === null) {
					overflow = new Error('Full-history ETL stdout exceeded its limit');
					if (timeoutTimer !== null) {
						clearTimeout(timeoutTimer);
						timeoutTimer = null;
					}
					signalChild('SIGKILL');
				}
				return;
			}
			stdout.push(chunk);
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderrBytes += chunk.byteLength;
			if (stderrBytes <= maximumStderrBytes) stderr.push(chunk);
		});
		child.once('spawn', () => {
			spawned = true;
		});
		child.on('error', onChildError);
		child.once('close', (code, processSignalName) => {
			closed = true;
			if (settled) return;
			settled = true;
			clearLifecycle();
			if (overflow !== null) return rejectPromise(overflow);
			if (terminationFailure !== null) return rejectPromise(terminationFailure);
			if (childFailure !== null) return rejectPromise(childFailure);
			if (code !== 0) {
				const detail = Buffer.concat(stderr).toString('utf8').trim();
				return rejectPromise(
					new Error(
						`Full-history ETL exited with ${code ?? processSignalName ?? 'unknown'}${detail.length > 0 ? `: ${detail}` : ''}`
					)
				);
			}
			resolvePromise(Buffer.concat(stdout));
		});
		signal.addEventListener('abort', onAbort, { once: true });
		timeoutTimer = setTimeout(
			() =>
				terminateGracefully(
					new Error(
						`Full-history ETL exceeded its ${timeoutMilliseconds}ms timeout`
					)
				),
			timeoutMilliseconds
		);
		timeoutTimer.unref();
		if (signal.aborted) onAbort();
	});
}

function spawnFullHistoryEtl(executablePath: string, args: readonly string[]) {
	return spawn(executablePath, args, {
		env: {
			GOMAXPROCS: '4',
			GOMEMLIMIT: '6GiB',
			LANG: 'C',
			TZ: 'UTC'
		},
		shell: false,
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

function abortFailure(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	return new Error('Full-history ETL process was aborted', {
		cause: signal.reason
	});
}

function processFailure(error: unknown, message: string): Error {
	return error instanceof Error ? error : new Error(message, { cause: error });
}

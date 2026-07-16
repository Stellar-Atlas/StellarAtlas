import { spawn } from 'node:child_process';
import type { FullHistoryTypedExportResult } from './FullHistoryTypedExportProtocol.js';

const maximumStderrBytes = 64 << 10;
const terminationGraceMilliseconds = 5_000;

export interface GoFullHistoryTypedExportRequest {
	readonly args: readonly string[];
	readonly consumeOutput: (
		output: AsyncIterable<Uint8Array>
	) => Promise<FullHistoryTypedExportResult>;
	readonly executablePath: string;
	readonly label: string;
	readonly signal: AbortSignal;
	readonly timeoutMilliseconds: number;
}

export type FullHistoryTypedExportRunner = (
	request: GoFullHistoryTypedExportRequest
) => Promise<FullHistoryTypedExportResult>;

export async function runGoFullHistoryTypedExport(
	request: GoFullHistoryTypedExportRequest
): Promise<FullHistoryTypedExportResult> {
	if (request.signal.aborted) throw abortFailure(request.signal);
	if (
		!Number.isInteger(request.timeoutMilliseconds) ||
		request.timeoutMilliseconds < 1_000 ||
		request.timeoutMilliseconds > 86_400_000
	) {
		throw new TypeError(
			`${request.label} timeout is outside its allowed range`
		);
	}

	const child = spawn(request.executablePath, [...request.args], {
		env: {
			GOMAXPROCS: '1',
			GOMEMLIMIT: '4GiB',
			LANG: 'C',
			TZ: 'UTC'
		},
		shell: false,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const stderr: Buffer[] = [];
	let stderrBytes = 0;
	let terminalFailure: Error | null = null;
	let outputFailure: Error | null = null;
	let terminationTimer: NodeJS.Timeout | null = null;
	let closed = false;

	child.stderr.on('data', (chunk: Buffer) => {
		const remaining = maximumStderrBytes - stderrBytes;
		if (remaining <= 0) return;
		const retained = chunk.subarray(0, remaining);
		stderr.push(retained);
		stderrBytes += retained.byteLength;
	});

	const signalChild = (signal: NodeJS.Signals): void => {
		try {
			child.kill(signal);
		} catch (error) {
			terminalFailure ??= processFailure(
				error,
				`${request.label} could not receive ${signal}`
			);
		}
	};
	const stopChild = (): void => {
		if (closed || terminationTimer !== null) return;
		signalChild('SIGTERM');
		terminationTimer = setTimeout(() => {
			terminationTimer = null;
			if (!closed) signalChild('SIGKILL');
		}, terminationGraceMilliseconds);
		terminationTimer.unref();
	};
	const terminate = (failure: Error): void => {
		terminalFailure ??= failure;
		stopChild();
	};
	const onAbort = (): void => terminate(abortFailure(request.signal));
	request.signal.addEventListener('abort', onAbort, { once: true });
	const timeoutTimer = setTimeout(
		() =>
			terminate(
				new Error(
					`${request.label} exceeded its ${request.timeoutMilliseconds}ms timeout`
				)
			),
		request.timeoutMilliseconds
	);
	timeoutTimer.unref();

	const close = waitForChildClose(child, request.label);
	const consumption = request.consumeOutput(child.stdout);
	consumption.catch((error: unknown) => {
		outputFailure ??= processFailure(
			error,
			`${request.label} output was rejected`
		);
		stopChild();
	});

	try {
		const result = await close;
		closed = true;
		if (terminalFailure !== null) {
			await consumption.catch(() => undefined);
			throw terminalFailure;
		}
		if (result.code !== 0) {
			await consumption.catch(() => undefined);
			const detail = Buffer.concat(stderr).toString('utf8').trim();
			throw new Error(
				`${request.label} exited with ${result.code ?? result.signal ?? 'unknown'}${detail.length > 0 ? `: ${detail}` : ''}`
			);
		}
		if (outputFailure !== null) throw outputFailure;
		return await consumption;
	} finally {
		closed = true;
		request.signal.removeEventListener('abort', onAbort);
		if (terminationTimer !== null) clearTimeout(terminationTimer);
		clearTimeout(timeoutTimer);
		if (child.exitCode === null && child.signalCode === null) {
			signalChild('SIGKILL');
		}
	}
}

function waitForChildClose(child: ReturnType<typeof spawn>, label: string) {
	return new Promise<{
		readonly code: number | null;
		readonly signal: NodeJS.Signals | null;
	}>((resolve, reject) => {
		child.once('error', (error) =>
			reject(processFailure(error, `${label} failed to spawn`))
		);
		child.once('close', (code, signal) => resolve({ code, signal }));
	});
}

function abortFailure(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	return new Error('Typed exporter was aborted', { cause: signal.reason });
}

function processFailure(error: unknown, message: string): Error {
	return error instanceof Error ? error : new Error(message, { cause: error });
}

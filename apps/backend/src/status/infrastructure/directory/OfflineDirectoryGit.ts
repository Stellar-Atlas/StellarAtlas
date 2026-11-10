import { execFile, spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const GIT_READ_DEADLINE_MS = 15_000;

export type ReadDirectoryGit = (
	args: readonly string[],
	options?: {
		readonly input?: string;
		readonly maxBuffer?: number;
		readonly allowExitOne?: boolean;
	}
) => Promise<{ readonly stdout: Buffer; readonly exitCode: 0 | 1 }>;

/** The caller supplies a trusted, approved standalone local Git directory. */
export async function openDirectoryGit(
	approvedGitDir: string,
	signal?: AbortSignal,
	mode: 'delta' | 'snapshot' = 'delta'
): Promise<ReadDirectoryGit & {
	listTree(tree: string): AsyncIterable<Buffer>;
}> {
	const deadline = performance.now() + GIT_READ_DEADLINE_MS;
	signal?.throwIfAborted();
	if (!isLocalAbsolutePath(approvedGitDir))
		throw new Error('Expected an approved absolute local Git directory');
	const gitDir = await realpath(approvedGitDir);
	if (
		!isLocalAbsolutePath(gitDir) ||
		!(await lstat(gitDir)).isDirectory() ||
		!(await lstat(join(gitDir, 'objects'))).isDirectory()
	)
		throw new Error('Expected a standalone local Git object directory');
	for (const path of [
		'commondir',
		'shallow',
		'info/grafts',
		'objects/info/alternates',
		'objects/info/http-alternates'
	]) {
		if (await exists(join(gitDir, path)))
			throw new Error(
				'Directory Git repository has redirected or incomplete history'
			);
	}

	const env = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name))
	);
	Object.assign(env, {
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
		// Older Git accepts the empty protocol allowlist even when it does not
		// recognize the newer lazy-fetch control.
		GIT_NO_LAZY_FETCH: '1',
		GIT_ALLOW_PROTOCOL: '',
		GIT_TERMINAL_PROMPT: '0',
		LC_ALL: 'C'
	});
	const gitArgs = [
		'--no-pager',
		'--no-replace-objects',
		'--no-optional-locks',
		'--literal-pathspecs',
		'--bare',
		'--git-dir=' + gitDir,
		'-c',
		'core.warnAmbiguousRefs=true'
	];
	const read: ReadDirectoryGit = async (args, options = {}) => {
		signal?.throwIfAborted();
		const timeout = mode === 'snapshot'
			? GIT_READ_DEADLINE_MS
			: Math.floor(deadline - performance.now());
		if (timeout < 1) throw new Error('Directory Git read deadline expired');
		const { input, maxBuffer = 24 * 1024, allowExitOne } = options;
		return new Promise((resolve, reject) => {
			const child = execFile(
				'git',
				[...gitArgs, ...args],
				{
					encoding: 'buffer',
					windowsHide: true,
					env,
					timeout,
					maxBuffer,
					signal
				},
				(error, stdout, stderr) => {
					if (signal?.aborted) {
						reject(signal.reason);
					} else if (
						stderr.length ||
						(error && !(allowExitOne && error.code === 1 && !error.killed))
					) {
						reject(
							new Error(
								`Directory Git ${args[0]} read failed or was incomplete`
							)
						);
					} else {
						resolve({ stdout, exitCode: error ? 1 : 0 });
					}
				}
			);
			// An early exit is reported by execFile and by output validation.
			child.stdin?.on('error', () => undefined);
			child.stdin?.end(input);
		});
	};
	return Object.assign(read, {
		async *listTree(tree: string) {
			signal?.throwIfAborted();
			const child = spawn('git', [
				...gitArgs, 'ls-tree', '-r', '-z', '--full-tree', tree, '--', 'accounts'
			], { env, signal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
			let failed = false;
			child.stderr.on('data', () => { failed = true; });
			child.on('error', () => { failed = true; });
			const closed = new Promise<boolean>((resolve) => {
				child.once('close', (code) => resolve(code === 0 && !failed));
			});
			const iterator = child.stdout[Symbol.asyncIterator]();
			async function* chunks() {
				while (true) {
					const chunk = await withGitReadDeadline(iterator.next());
					if (chunk.done) return;
					yield chunk.value as Buffer;
				}
			}
			try {
				yield* readDirectoryFrames(chunks(), 0, 128);
				signal?.throwIfAborted();
				if (!(await withGitReadDeadline(closed)))
					throw new Error('Directory Git ls-tree read failed or was incomplete');
			} finally {
				child.kill();
				child.stdout.destroy();
				await closed;
			}
		}
	});
}

async function withGitReadDeadline<T>(pending: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			pending,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('Directory Git read deadline expired')),
					GIT_READ_DEADLINE_MS);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** Retain only the unfinished frame across stream chunks. */
export async function* readDirectoryFrames(
	chunks: AsyncIterable<Buffer>,
	delimiter: number,
	maxFrameBytes: number
): AsyncGenerator<Buffer> {
	let parts: Buffer[] = [];
	let size = 0;
	for await (const chunk of chunks) {
		let offset = 0;
		while (offset < chunk.length) {
			const end = chunk.indexOf(delimiter, offset);
			const part = chunk.subarray(offset, end < 0 ? undefined : end);
			size += part.length;
			if (size > maxFrameBytes)
				throw new Error('Directory stream frame exceeds its byte limit');
			if (part.length) parts.push(part);
			if (end < 0) break;
			yield parts.length === 1 ? parts[0]! : Buffer.concat(parts, size);
			parts = [];
			size = 0;
			offset = end + 1;
		}
	}
	if (size)
		throw new Error('Directory stream ended with an incomplete frame');
}

function isLocalAbsolutePath(path: string): boolean {
	return (
		typeof path === 'string' &&
		(process.platform === 'win32'
			? /^[A-Za-z]:[\\/]/.test(path)
			: isAbsolute(path) && !path.startsWith('//'))
	);
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

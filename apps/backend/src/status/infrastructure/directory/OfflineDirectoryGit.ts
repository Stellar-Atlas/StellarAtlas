import { execFile } from 'node:child_process';
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
	signal?: AbortSignal
): Promise<ReadDirectoryGit> {
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
		GIT_ALLOW_PROTOCOL: '',
		GIT_TERMINAL_PROMPT: '0',
		LC_ALL: 'C'
	});
	return async (args, options = {}) => {
		signal?.throwIfAborted();
		const timeout = Math.floor(deadline - performance.now());
		if (timeout < 1) throw new Error('Directory Git read deadline expired');
		const { input, maxBuffer = 24 * 1024, allowExitOne } = options;
		return new Promise((resolve, reject) => {
			const child = execFile(
				'git',
				[
					'--no-pager',
					'--no-replace-objects',
					'--no-lazy-fetch',
					'--no-optional-locks',
					'--literal-pathspecs',
					'--bare',
					'--git-dir=' + gitDir,
					'-c',
					'core.warnAmbiguousRefs=true',
					...args
				],
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

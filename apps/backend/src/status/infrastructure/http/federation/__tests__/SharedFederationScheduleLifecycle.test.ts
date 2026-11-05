import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
	access,
	mkdir,
	mkdtemp,
	open,
	readFile,
	rmdir,
	unlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { ScheduledFederationProviderBudget } from '../FederationProviderBudget.js';
import {
	recoverFederationSchedule,
	SharedFederationScheduleStore
} from '../SharedFederationScheduleStore.js';

const workerSource = `
	import { registerHooks } from 'node:module';
	import { readFileSync } from 'node:fs';
	import { access, writeFile } from 'node:fs/promises';
	import { join } from 'node:path';
	import { setTimeout } from 'node:timers/promises';
	import ts from 'typescript';

	registerHooks({
		resolve(specifier, context, nextResolve) {
			if (context.parentURL?.endsWith('.ts') && specifier.startsWith('.') && specifier.endsWith('.js'))
				specifier = specifier.slice(0, -3) + '.ts';
			return nextResolve(specifier, context);
		},
		load(url, context, nextLoad) {
			if (!url.startsWith('file:') || !url.endsWith('.ts')) return nextLoad(url, context);
			const source = ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
				compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext }
			}).outputText;
			return { format: 'module', source, shortCircuit: true };
		}
	});
	const [, directory, budgetUrl, storeUrl, mode] = process.argv;
	const { ScheduledFederationProviderBudget } = await import(budgetUrl);
	const { SharedFederationScheduleStore } = await import(storeUrl);
	const budget = new ScheduledFederationProviderBudget(new SharedFederationScheduleStore(directory), () => 10000);
	// Leave no referenced fixture handles after the callback returns.
	void budget.run('provider.example', async () => {
		await writeFile(join(directory, 'admitted'), '', { flag: 'wx' });
		if (mode === 'crash-holder') {
			await writeFile(join(directory, 'federation-schedule.lock'), 'fixture owner', { flag: 'wx' });
			await writeFile(join(directory, 'held'), '', { flag: 'wx' });
			await setTimeout(30000);
		}
		for (;;) {
			try { await access(join(directory, 'federation-schedule.lock')); break; }
			catch (error) { if (error.code !== 'ENOENT') throw error; }
			await setTimeout(10);
		}
		await writeFile(join(directory, 'responded'), '', { flag: 'wx' });
		return { status: 200, headers: {}, body: Buffer.alloc(0) };
	}).then(() => writeFile(join(directory, 'settled'), '', { flag: 'wx' })).catch(() => {
		process.exitCode = 1;
	});
`;

function startWorker(directory: string, mode = 'normal') {
	const worker = spawn(
		process.execPath,
		[
			'--input-type=module',
			'--eval',
			workerSource,
			directory,
			new URL('../FederationProviderBudget.ts', import.meta.url).href,
			new URL('../SharedFederationScheduleStore.ts', import.meta.url).href,
			mode
		],
		{ windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'], timeout: 8000 }
	);
	const exited = once(worker, 'close');
	void exited.catch(() => undefined);
	return { worker, exited };
}

it('keeps an idle process alive to settle a completed request after ordinary lock contention', async () => {
	const directory = await mkdtemp(
		join(tmpdir(), 'atlas-federation-lifecycle-')
	);
	const lockPath = join(directory, 'federation-schedule.lock');
	const { worker, exited } = startWorker(directory);
	let lock: Awaited<ReturnType<typeof open>> | undefined;
	try {
		await waitForFile(join(directory, 'admitted'), exited);
		lock = await open(lockPath, 'wx', 0o600);
		await waitForFile(join(directory, 'responded'), exited);
		await setTimeout(850);
		const exitedWhileLocked =
			worker.exitCode !== null || worker.signalCode !== null;
		await lock.close();
		lock = undefined;
		await unlink(lockPath);
		expect(await exited).toEqual([0, null]);
		expect(exitedWhileLocked).toBe(false);
		await expect(access(join(directory, 'settled'))).resolves.toBeUndefined();
		const rows = JSON.parse(
			await readFile(join(directory, 'federation-schedule.json'), 'utf8')
		);
		expect(rows).toEqual([['provider.example', 70_000, 1, 0, 0, 0]]);
	} finally {
		if (lock) {
			await lock.close();
			await unlink(lockPath);
		}
		if (worker.exitCode === null && worker.signalCode === null) worker.kill();
		await exited.catch(() => undefined);
		await clean(directory);
	}
}, 12_000);

it('recovers a killed owner into a new generation without clearing the old lock or refunding quota', async () => {
	const root = await mkdtemp(join(tmpdir(), 'atlas-federation-recovery-'));
	const old = join(root, 'old');
	const replacement = join(root, 'replacement');
	const state = 'federation-schedule.json';
	const lock = 'federation-schedule.lock';
	await mkdir(old, { mode: 0o700 });
	const { worker, exited } = startWorker(old, 'crash-holder');
	try {
		await waitForFile(join(old, 'held'), exited);
		expect(worker.kill()).toBe(true);
		expect((await exited)[0]).not.toBe(0);
		const oldState = await readFile(join(old, state), 'utf8');
		expect(JSON.parse(oldState)).toEqual([
			['provider.example', 70_000, 1, 1, 0, 0]
		]);
		const uncertain = join(old, 'federation-schedule.next');
		await writeFile(uncertain, 'uncertain write', { flag: 'wx' });
		await expect(
			recoverFederationSchedule(old, replacement, true)
		).rejects.toThrow('Uncertain');
		await unlink(uncertain);
		await recoverFederationSchedule(old, replacement, true);
		expect(await readFile(join(old, lock), 'utf8')).toBe('fixture owner');
		expect(await readFile(join(old, state), 'utf8')).toBe(oldState);
		expect(
			JSON.parse(await readFile(join(replacement, state), 'utf8'))
		).toEqual([['provider.example', 70_000, 1, 0, 0, 0]]);
		const request = jest.fn(async () => ({
			status: 200,
			headers: {},
			body: Buffer.alloc(0)
		}));
		const budget = new ScheduledFederationProviderBudget(
			new SharedFederationScheduleStore(replacement),
			() => 10_000
		);
		for (let i = 0; i < 7; i++) await budget.run('provider.example', request);
		await expect(budget.run('provider.example', request)).rejects.toMatchObject(
			{ retryAtMs: 70_000 }
		);
		expect(request).toHaveBeenCalledTimes(7);
	} finally {
		if (worker.exitCode === null && worker.signalCode === null) worker.kill();
		await exited.catch(() => undefined);
		await clean(old);
		await clean(replacement);
		await rmdir(root);
	}
}, 12_000);

async function clean(directory: string): Promise<void> {
	for (const file of [
		'admitted',
		'held',
		'responded',
		'settled',
		'federation-schedule.lock',
		'federation-schedule.next',
		'federation-schedule.json'
	]) {
		await unlink(join(directory, file)).catch(
			(error: NodeJS.ErrnoException) => {
				if (error.code !== 'ENOENT') throw error;
			}
		);
	}
	await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== 'ENOENT') throw error;
	});
}

async function waitForFile(
	path: string,
	exited: Promise<unknown>
): Promise<void> {
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		try {
			await access(path);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
		await Promise.race([
			setTimeout(10),
			exited.then(() => {
				throw new Error(
					'Federation fixture worker exited before synchronization'
				);
			})
		]);
	}
	throw new Error('Federation fixture synchronization timed out');
}

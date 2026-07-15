import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const postgresBinDirectory =
	process.env.POSTGRES_TEST_BIN_DIRECTORY ?? '/usr/lib/postgresql/16/bin';

export interface DisposablePostgres {
	readonly dataDirectory: string;
	readonly url: string;
	restart(controlTimeoutSeconds?: number): Promise<void>;
	stop(): Promise<void>;
}

export async function startDisposablePostgres(): Promise<DisposablePostgres> {
	const directory = await mkdtemp(join(tmpdir(), 'stellaratlas-postgres-'));
	const port = await reservePort();
	const initdb = join(postgresBinDirectory, 'initdb');
	const pgCtl = join(postgresBinDirectory, 'pg_ctl');

	try {
		await execFileAsync(initdb, [
			'-D',
			directory,
			'--auth=trust',
			'--encoding=UTF8',
			'--no-instructions',
			'--no-locale',
			'--username=postgres'
		]);
		await execFileAsync(pgCtl, [
			'-D',
			directory,
			'-l',
			join(directory, 'postgres.log'),
			'-o',
			`-F -h 127.0.0.1 -k ${directory} -p ${port} -c allow_system_table_mods=on`,
			'-t',
			'20',
			'-w',
			'start'
		]);
	} catch (error) {
		await rm(directory, { force: true, recursive: true });
		throw error;
	}

	let stopped = false;
	return {
		dataDirectory: directory,
		url: `postgresql://postgres@127.0.0.1:${port}/postgres`,
		async restart(controlTimeoutSeconds = 20) {
			if (stopped) throw new Error('Disposable PostgreSQL is stopped');
			assertControlTimeout(controlTimeoutSeconds);
			await execFileAsync(pgCtl, [
				'-D',
				directory,
				'-m',
				'immediate',
				'-t',
				controlTimeoutSeconds.toString(),
				'-w',
				'stop'
			]);
			await execFileAsync(pgCtl, [
				'-D',
				directory,
				'-l',
				join(directory, 'postgres.log'),
				'-o',
				`-F -h 127.0.0.1 -k ${directory} -p ${port} -c allow_system_table_mods=on`,
				'-t',
				controlTimeoutSeconds.toString(),
				'-w',
				'start'
			]);
		},
		async stop() {
			if (stopped) return;
			stopped = true;
			try {
				await execFileAsync(pgCtl, [
					'-D',
					directory,
					'-m',
					'immediate',
					'-t',
					'20',
					'-w',
					'stop'
				]);
			} finally {
				await rm(directory, { force: true, recursive: true });
			}
		}
	};
}

function assertControlTimeout(value: number): void {
	if (!Number.isInteger(value) || value < 1 || value > 600) {
		throw new Error('Disposable PostgreSQL control timeout must be 1-600 seconds');
	}
}

async function reservePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error === undefined ? resolve() : reject(error)));
	});
	if (address === null || typeof address === 'string') {
		throw new Error('Disposable PostgreSQL could not reserve a TCP port');
	}

	return address.port;
}

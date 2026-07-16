import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.HOME ?? '/home/observe';
const dataRoot = '/home/observe/stellarbeat-data';
const horizonRoot = join(dataRoot, 'horizon');
const postgresData = join(horizonRoot, 'postgres', '27');
const postgresRun = join(horizonRoot, 'postgres', 'run');
const postgresConfig = join(
	horizonRoot,
	'postgres',
	'config',
	'postgresql.conf'
);
const userUnitRoot = join(home, '.config', 'systemd', 'user');
const environmentRoot = join(home, '.config', 'stellaratlas');
const environmentPath = join(environmentRoot, 'full-history.env');
const socketDatabaseUrl =
	'postgresql:///horizon?host=/home/observe/stellarbeat-data/horizon/postgres/run&port=5433&sslmode=disable';
const startServices = process.argv.includes('--start');

await verifyExecutable(join(horizonRoot, 'bin', 'horizon'));
await verifyExecutable(join(dataRoot, 'stellar-core', 'bin', 'stellar-core'));
await verifyExecutable(join(dataRoot, 'stellar-rpc', 'bin', 'stellar-rpc'));

await createRuntimeDirectories();
await installRuntimeConfiguration();
await initializePostgres();
await run('systemctl', ['--user', 'daemon-reload']);
await run('systemctl', [
	'--user',
	'enable',
	'--now',
	'stellaratlas-horizon-postgres.service'
]);
await waitForPostgres();
await initializeHorizonDatabase();

if (startServices) {
	await run('systemctl', [
		'--user',
		'enable',
		'--now',
		'stellaratlas-horizon.service',
		'stellaratlas-stellar-rpc.service'
	]);
}

console.log(
	startServices
		? 'Owned Horizon and Stellar RPC user services are installed and started.'
		: 'Owned Horizon and Stellar RPC user services are installed. Pass --start to start them.'
);

async function createRuntimeDirectories() {
	for (const path of [
		join(horizonRoot, 'captive-core', 'pubnet'),
		join(horizonRoot, 'logs'),
		dirname(postgresConfig),
		postgresRun,
		join(dataRoot, 'stellar-rpc', 'pubnet', 'captive-core'),
		join(dataRoot, 'stellar-rpc', 'pubnet', 'config'),
		join(dataRoot, 'stellar-rpc', 'pubnet', 'data'),
		userUnitRoot,
		environmentRoot
	]) {
		await mkdir(path, { mode: 0o755, recursive: true });
	}
}

async function installRuntimeConfiguration() {
	await copyFile(
		join(repositoryRoot, 'ops', 'full-history', 'horizon-postgresql.conf'),
		postgresConfig
	);
	await copyFile(
		join(repositoryRoot, 'ops', 'full-history', 'stellar-rpc-pubnet.toml'),
		join(dataRoot, 'stellar-rpc', 'pubnet', 'config', 'rpc.toml')
	);
	for (const unit of [
		'stellaratlas-horizon-postgres.service',
		'stellaratlas-horizon.service',
		'stellaratlas-stellar-rpc.service'
	]) {
		await copyFile(
			join(repositoryRoot, 'ops', 'systemd', 'user', unit),
			join(userUnitRoot, unit)
		);
	}
	await writeFile(environmentPath, `DATABASE_URL="${socketDatabaseUrl}"\n`, {
		mode: 0o600
	});
	await chmod(environmentPath, 0o600);
}

async function initializePostgres() {
	try {
		await access(join(postgresData, 'PG_VERSION'), constants.R_OK);
		return;
	} catch {
		await mkdir(postgresData, { mode: 0o700, recursive: true });
	}
	await run('/usr/lib/postgresql/16/bin/initdb', [
		'-D',
		postgresData,
		'--auth-local=peer',
		'--auth-host=scram-sha-256',
		'--encoding=UTF8',
		'--locale=C.UTF-8',
		'--username=observe'
	]);
}

async function waitForPostgres() {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (
			await succeeds('/usr/lib/postgresql/16/bin/pg_isready', [
				'-h',
				postgresRun,
				'-p',
				'5433'
			])
		) {
			return;
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
	}
	throw new Error('Horizon PostgreSQL did not become ready within 60 seconds');
}

async function initializeHorizonDatabase() {
	const databaseExists = await capture('/usr/lib/postgresql/16/bin/psql', [
		'-h',
		postgresRun,
		'-p',
		'5433',
		'-d',
		'postgres',
		'-Atc',
		"select 1 from pg_database where datname = 'horizon'"
	]);
	if (databaseExists.trim() !== '1') {
		await run('/usr/lib/postgresql/16/bin/createdb', [
			'-h',
			postgresRun,
			'-p',
			'5433',
			'horizon'
		]);
	}
	const schemaExists = await capture('/usr/lib/postgresql/16/bin/psql', [
		'-h',
		postgresRun,
		'-p',
		'5433',
		'-d',
		'horizon',
		'-Atc',
		"select to_regclass('public.history_ledgers') is not null"
	]);
	if (schemaExists.trim() !== 't') {
		await run(join(horizonRoot, 'bin', 'horizon'), [
			'db',
			'init',
			'--db-url',
			socketDatabaseUrl
		]);
	}
	await run(join(horizonRoot, 'bin', 'horizon'), [
		'db',
		'migrate',
		'up',
		'--db-url',
		socketDatabaseUrl
	]);
}

async function verifyExecutable(path) {
	await access(path, constants.X_OK);
}

async function succeeds(executable, args) {
	try {
		await run(executable, args, { quiet: true });
		return true;
	} catch {
		return false;
	}
}

async function capture(executable, args) {
	return new Promise((resolvePromise, rejectPromise) => {
		let output = '';
		const child = spawn(executable, args, {
			env: process.env,
			stdio: ['ignore', 'pipe', 'inherit']
		});
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			output += chunk;
		});
		child.once('error', rejectPromise);
		child.once('exit', (code, signal) => {
			if (code === 0) return resolvePromise(output);
			rejectPromise(
				new Error(
					`${executable} exited with ${code ?? signal ?? 'unknown status'}`
				)
			);
		});
	});
}

async function run(executable, args, options = {}) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(executable, args, {
			env: process.env,
			stdio: options.quiet ? 'ignore' : 'inherit'
		});
		child.once('error', rejectPromise);
		child.once('exit', (code, signal) => {
			if (code === 0) return resolvePromise();
			rejectPromise(
				new Error(
					`${executable} exited with ${code ?? signal ?? 'unknown status'}`
				)
			);
		});
	});
}

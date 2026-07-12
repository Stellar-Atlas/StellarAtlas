import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { resolveAppEnvPath } from 'shared/lib/env/resolve-app-env-path.js';
import { managedMigrations } from './ManagedMigrations.js';

config({
	path: resolveAppEnvPath(import.meta.url, 'backend'),
	quiet: true
});

function parseBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;

	const normalized = value.trim().toLowerCase();
	if (['1', 'true', 'yes', 'on', 'require'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off', 'disable'].includes(normalized)) return false;

	return undefined;
}

export function databaseMigrationsEnabled(value: string | undefined): boolean {
	return parseBoolean(value) ?? false;
}

function databaseSslEnabled(): boolean {
	const explicitSsl = parseBoolean(process.env.DATABASE_SSL);
	if (explicitSsl !== undefined) return explicitSsl;

	const pgSslMode = parseBoolean(process.env.PGSSLMODE);
	if (pgSslMode !== undefined) return pgSslMode;

	const databaseUrl = process.env.ACTIVE_DATABASE_URL;
	if (databaseUrl !== undefined) {
		const urlSslMode = new URL(databaseUrl).searchParams.get('sslmode');
		const parsedUrlSslMode = parseBoolean(urlSslMode ?? undefined);
		if (parsedUrlSslMode !== undefined) return parsedUrlSslMode;
	}

	return false;
}

const useDatabaseSsl = databaseSslEnabled();
const runMigrations = databaseMigrationsEnabled(
	process.env.DATABASE_MIGRATIONS_RUN
);

const AppDataSource = new DataSource({
	type: 'postgres',
	logging: false,
	synchronize: false,
	url: process.env.ACTIVE_DATABASE_URL,
	entities: ['lib/**/entities/*.js', 'lib/**/domain/**/!(*.test)*.js'],
	migrations: [...managedMigrations],
	migrationsRun: runMigrations,
	migrationsTransactionMode: 'each',
	ssl: useDatabaseSsl,
	extra: useDatabaseSsl
		? {
				ssl: {
					rejectUnauthorized: false
				}
			}
		: undefined,
	poolSize: process.env.DATABASE_POOL_SIZE
		? parseInt(process.env.DATABASE_POOL_SIZE)
		: 10
});

export { AppDataSource };

import { AppDataSource, databaseMigrationsEnabled } from '../AppDataSource.js';
import { resolveDatabasePoolPolicy } from '../DatabasePoolPolicy.js';
import { managedMigrations } from '../ManagedMigrations.js';

describe('AppDataSource migration startup policy', () => {
	it('uses the explicit post-baseline migration registry', () => {
		const migrations = AppDataSource.options.migrations ?? [];
		expect(migrations).toEqual([...managedMigrations]);
		expect(
			migrations.every((migration) => typeof migration === 'function')
		).toBe(true);
	});

	it('wires the startup option through the fail-closed policy', () => {
		expect(AppDataSource.options.migrationsRun).toBe(
			databaseMigrationsEnabled(process.env.DATABASE_MIGRATIONS_RUN)
		);
	});

	it('configures the PostgreSQL pool before initialization', () => {
		const policy = resolveDatabasePoolPolicy();
		expect(AppDataSource.options.poolSize).toBe(policy.poolSize);
		expect(AppDataSource.options.connectTimeoutMS).toBe(
			policy.connectionTimeoutMs
		);
	});

	it.each([undefined, '', 'unexpected'])('fails closed for %p', (value) => {
		expect(databaseMigrationsEnabled(value)).toBe(false);
	});

	it.each(['1', 'true', 'yes', 'on', 'require'])(
		'enables migrations only for explicit %s',
		(value) => {
			expect(databaseMigrationsEnabled(value)).toBe(true);
		}
	);

	it.each(['0', 'false', 'no', 'off', 'disable'])(
		'keeps migrations off for explicit %s',
		(value) => {
			expect(databaseMigrationsEnabled(value)).toBe(false);
		}
	);
});

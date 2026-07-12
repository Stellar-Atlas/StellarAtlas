import { AppDataSource } from '../database/AppDataSource.js';
import { MigrationExecutor } from 'typeorm';

const apply = process.argv.slice(2).includes('--apply');

try {
	await AppDataSource.initialize();
	const pendingMigrations = await new MigrationExecutor(
		AppDataSource
	).getPendingMigrations();
	if (pendingMigrations.length === 0) {
		console.log('No pending backend migrations.');
	} else if (!apply) {
		for (const migration of pendingMigrations) {
			console.log(`Pending ${migration.name}`);
		}
		console.log('Re-run with --apply after reviewing the build.');
		process.exitCode = 2;
	} else {
		const migrations = await AppDataSource.runMigrations({
			transaction: 'each'
		});
		for (const migration of migrations)
			console.log(`Applied ${migration.name}`);
		console.log(`Applied ${migrations.length} backend migrations.`);
	}
} catch (error) {
	console.error(
		error instanceof Error ? error.message : 'Migration command failed'
	);
	process.exitCode = 1;
} finally {
	if (AppDataSource.isInitialized) await AppDataSource.destroy();
}

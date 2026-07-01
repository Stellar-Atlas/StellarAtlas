import { DataSource } from 'typeorm';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const TestingAppDataSource: DataSource = new DataSource({
	type: 'postgres',
	dropSchema: true,
	synchronize: true,
	logging: false,
	url: process.env.DATABASE_TEST_URL,
	entities: [
		path.resolve(currentDir, '../../../**/entities/*.ts'),
		path.resolve(currentDir, '../../../**/domain/**/!(*.test)*.ts')
	],
	migrationsRun: false,
	ssl: false
});

export { TestingAppDataSource };

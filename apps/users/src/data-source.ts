import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAppEnvPath } from 'shared';

config({
	path: resolveAppEnvPath(import.meta.url, 'users'),
	quiet: true
});

import { DataSource } from 'typeorm';
import { User } from './User.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const dataSource = new DataSource({
	type: 'postgres',
	url: process.env.DATABASE_URL,
	entities: [User],
	migrations: [path.join(currentDir, 'migrations/*.{ts,js}')],
	migrationsRun: true,
	synchronize: false,
	logging: process.env.NODE_ENV === 'development',
	ssl: false
});

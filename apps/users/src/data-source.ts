import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

config();

import { DataSource } from 'typeorm';
import { User } from './User.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

console.log('DATABASE_URL:', process.env.DATABASE_URL);

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

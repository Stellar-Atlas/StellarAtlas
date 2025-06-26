import { config } from 'dotenv';
config();

import { DataSource } from 'typeorm';
import { User } from './User';

console.log('DATABASE_URL:', process.env.DATABASE_URL);

export const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  migrationsRun: true,
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  ssl: false
});

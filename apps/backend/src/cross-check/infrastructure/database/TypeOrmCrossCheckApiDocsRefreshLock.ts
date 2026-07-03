import { DataSource } from 'typeorm';
import type { CrossCheckApiDocsRefreshLock } from '@cross-check/domain/CrossCheckApiDocsRefreshLock.js';
import { TypeOrmCrossCheckRefreshLock } from './TypeOrmCrossCheckRefreshLock.js';

const lockName = 'cross-check-api-docs-refresh';

export class TypeOrmCrossCheckApiDocsRefreshLock
	extends TypeOrmCrossCheckRefreshLock
	implements CrossCheckApiDocsRefreshLock
{
	constructor(dataSource: DataSource) {
		super(dataSource, lockName);
	}
}

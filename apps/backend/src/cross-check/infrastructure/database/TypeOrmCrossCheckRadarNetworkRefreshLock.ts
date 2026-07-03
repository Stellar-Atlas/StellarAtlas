import { DataSource } from 'typeorm';
import { TypeOrmCrossCheckRefreshLock } from './TypeOrmCrossCheckRefreshLock.js';

const lockName = 'cross-check-radar-network-refresh';

export class TypeOrmCrossCheckRadarNetworkRefreshLock extends TypeOrmCrossCheckRefreshLock {
	constructor(dataSource: DataSource) {
		super(dataSource, lockName);
	}
}

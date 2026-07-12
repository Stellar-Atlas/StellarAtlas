import { DataSource } from 'typeorm';
import { TestUtils } from '@core/utilities/TestUtils.js';
import Organization from '@network-scan/domain/organization/Organization.js';
import OrganizationMeasurement from '@network-scan/domain/organization/OrganizationMeasurement.js';
import type { OrganizationMeasurementRepository } from '@network-scan/domain/organization/OrganizationMeasurementRepository.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import OrganizationSnapShot from '@network-scan/domain/organization/OrganizationSnapShot.js';
import { OrganizationTomlAttemptRecord } from '@network-scan/domain/organization/OrganizationTomlAttemptRecord.js';
import { OrganizationTomlContent } from '@network-scan/domain/organization/OrganizationTomlContent.js';
import { OrganizationTomlSnapshot } from '@network-scan/domain/organization/OrganizationTomlSnapshot.js';
import { TypeOrmOrganizationMeasurementRepository } from '../TypeOrmOrganizationMeasurementRepository.js';
import { TypeOrmOrganizationRepository } from '../TypeOrmOrganizationRepository.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

export class OrganizationTomlPostgresTestContext {
	private constructor(
		readonly dataSource: DataSource,
		readonly organizationRepository: OrganizationRepository,
		readonly measurementRepository: OrganizationMeasurementRepository,
		private readonly postgres: DisposablePostgres
	) {}

	static async start(): Promise<OrganizationTomlPostgresTestContext> {
		const postgres = await startDisposablePostgres();
		const dataSource = new DataSource({
			dropSchema: true,
			entities: [
				Organization,
				OrganizationMeasurement,
				OrganizationSnapShot,
				OrganizationTomlAttemptRecord,
				OrganizationTomlContent,
				OrganizationTomlSnapshot
			],
			logging: false,
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		return new OrganizationTomlPostgresTestContext(
			dataSource,
			new TypeOrmOrganizationRepository(dataSource.getRepository(Organization)),
			new TypeOrmOrganizationMeasurementRepository(
				dataSource.getRepository(OrganizationMeasurement)
			),
			postgres
		);
	}

	async reset(): Promise<void> {
		await TestUtils.resetDB(this.dataSource);
	}

	async stop(): Promise<void> {
		if (this.dataSource.isInitialized) await this.dataSource.destroy();
		await this.postgres.stop();
	}
}

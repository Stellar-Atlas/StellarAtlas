import { DataSource } from 'typeorm';
import Kernel from '../Kernel.js';
import { ConfigMock } from '../../config/__mocks__/configMock.js';
import type { NodeMeasurementRepository } from '@network-scan/domain/node/NodeMeasurementRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { TypeOrmNodeMeasurementRepository } from '@network-scan/infrastructure/database/repositories/TypeOrmNodeMeasurementRepository.js';
import { TypeOrmOrganizationRepository } from '@network-scan/infrastructure/database/repositories/TypeOrmOrganizationRepository.js';
import { GetApiDocsComparisonSnapshot } from '@cross-check/use-cases/get-api-docs-comparison-snapshot/GetApiDocsComparisonSnapshot.js';
import { GetCrossCheckArchives } from '@cross-check/use-cases/get-cross-check-archives/GetCrossCheckArchives.js';
import { GetCrossCheckOrganizations } from '@cross-check/use-cases/get-cross-check-organizations/GetCrossCheckOrganizations.js';
import { GetCrossCheckSources } from '@cross-check/use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import { GetCrossCheckValidators } from '@cross-check/use-cases/get-cross-check-validators/GetCrossCheckValidators.js';
import { GetFbasAnalysisProof } from '@fbas/use-cases/get-fbas-analysis-proof/GetFbasAnalysisProof.js';
import { GetFbasAnalysis } from '@fbas/use-cases/get-fbas-analysis/GetFbasAnalysis.js';
import { GetLatestFbas } from '@fbas/use-cases/get-latest-fbas/GetLatestFbas.js';
import { GetTopTierHistory } from '@fbas/use-cases/get-top-tier-history/GetTopTierHistory.js';

jest.setTimeout(10000); //slow and long integration test

test('kernel', async () => {
	const kernel = await Kernel.getInstance(new ConfigMock());
	const container = kernel.container;
	expect(
		container.get<NodeMeasurementRepository>(
			NETWORK_TYPES.NodeMeasurementRepository
		)
	).toBeInstanceOf(TypeOrmNodeMeasurementRepository);
	expect(container.get(DataSource)).toBeInstanceOf(DataSource);
	expect(container.get(NETWORK_TYPES.OrganizationRepository)).toBeInstanceOf(
		TypeOrmOrganizationRepository
	);
	expect(container.get(GetCrossCheckSources)).toBeInstanceOf(
		GetCrossCheckSources
	);
	expect(container.get(GetApiDocsComparisonSnapshot)).toBeInstanceOf(
		GetApiDocsComparisonSnapshot
	);
	expect(container.get(GetCrossCheckArchives)).toBeInstanceOf(
		GetCrossCheckArchives
	);
	expect(container.get(GetCrossCheckOrganizations)).toBeInstanceOf(
		GetCrossCheckOrganizations
	);
	expect(container.get(GetCrossCheckValidators)).toBeInstanceOf(
		GetCrossCheckValidators
	);
	expect(container.get(GetFbasAnalysis)).toBeInstanceOf(GetFbasAnalysis);
	expect(container.get(GetFbasAnalysisProof)).toBeInstanceOf(
		GetFbasAnalysisProof
	);
	expect(container.get(GetLatestFbas)).toBeInstanceOf(GetLatestFbas);
	expect(container.get(GetTopTierHistory)).toBeInstanceOf(GetTopTierHistory);

	await kernel.close();
});

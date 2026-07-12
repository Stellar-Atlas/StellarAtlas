import { DataSource } from 'typeorm';
import { ConfigMock } from '../../config/__mocks__/configMock.js';
import type { NodeMeasurementRepository } from '@network-scan/domain/node/NodeMeasurementRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { GetKnownNode } from '@network-scan/use-cases/get-known-node/GetKnownNode.js';
import { GetKnownNodes } from '@network-scan/use-cases/get-known-nodes/GetKnownNodes.js';
import { GetKnownOrganization } from '@network-scan/use-cases/get-known-organization/GetKnownOrganization.js';
import { GetKnownOrganizations } from '@network-scan/use-cases/get-known-organizations/GetKnownOrganizations.js';
import { TypeOrmNodeMeasurementRepository } from '@network-scan/infrastructure/database/repositories/TypeOrmNodeMeasurementRepository.js';
import { TypeOrmOrganizationRepository } from '@network-scan/infrastructure/database/repositories/TypeOrmOrganizationRepository.js';
import { GetApiDocsComparisonSnapshot } from '@cross-check/use-cases/get-api-docs-comparison-snapshot/GetApiDocsComparisonSnapshot.js';
import { CROSS_CHECK_TYPES } from '@cross-check/domain/CrossCheckTypes.js';
import { TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository } from '@cross-check/infrastructure/database/repositories/TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository.js';
import { GetCrossCheckArchives } from '@cross-check/use-cases/get-cross-check-archives/GetCrossCheckArchives.js';
import { GetCrossCheckOrganizations } from '@cross-check/use-cases/get-cross-check-organizations/GetCrossCheckOrganizations.js';
import { GetCrossCheckSources } from '@cross-check/use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import { GetCrossCheckValidators } from '@cross-check/use-cases/get-cross-check-validators/GetCrossCheckValidators.js';
import { GetRadarNetworkComparisonSnapshot } from '@cross-check/use-cases/get-radar-network-comparison-snapshot/GetRadarNetworkComparisonSnapshot.js';
import { ListRadarNetworkComparisonSnapshots } from '@cross-check/use-cases/list-radar-network-comparison-snapshots/ListRadarNetworkComparisonSnapshots.js';
import { GetFbasAnalysisProof } from '@fbas/use-cases/get-fbas-analysis-proof/GetFbasAnalysisProof.js';
import { GetFbasAnalysis } from '@fbas/use-cases/get-fbas-analysis/GetFbasAnalysis.js';
import { GetLatestFbasProofSets } from '@fbas/use-cases/get-latest-fbas-proof-sets/GetLatestFbasProofSets.js';
import { GetLatestFbas } from '@fbas/use-cases/get-latest-fbas/GetLatestFbas.js';
import { GetTopTierHistory } from '@fbas/use-cases/get-top-tier-history/GetTopTierHistory.js';
import type { KnownArchiveEvidenceRepository } from '@history-scan-coordinator/domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { TYPES as HISTORY_SCAN_TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import { TypeOrmKnownArchiveEvidenceRepository } from '@history-scan-coordinator/infrastructure/repositories/database/TypeOrmKnownArchiveEvidenceRepository.js';
import { GetHistoryArchiveEvidence } from '@history-scan-coordinator/use-cases/get-history-archive-evidence/GetHistoryArchiveEvidence.js';
import { GetKnownArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-archive-evidence/GetKnownArchiveEvidence.js';
import { GetKnownNodeArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-node-archive-evidence/GetKnownNodeArchiveEvidence.js';
import { GetKnownOrganizationArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-organization-archive-evidence/GetKnownOrganizationArchiveEvidence.js';
import { startDisposablePostgres } from '@test-support/DisposablePostgres.js';

jest.setTimeout(60_000);

test('kernel', async () => {
	const previousDatabaseTestUrl = process.env.DATABASE_TEST_URL;
	const postgres = await startDisposablePostgres();
	process.env.DATABASE_TEST_URL = postgres.url;

	try {
		const { default: Kernel } = await import('../Kernel.js');
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
		expect(
			container.get(CROSS_CHECK_TYPES.RadarNetworkComparisonSnapshotRepository)
		).toBeInstanceOf(TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository);
		expect(container.get(GetRadarNetworkComparisonSnapshot)).toBeInstanceOf(
			GetRadarNetworkComparisonSnapshot
		);
		expect(container.get(ListRadarNetworkComparisonSnapshots)).toBeInstanceOf(
			ListRadarNetworkComparisonSnapshots
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
		expect(container.get(GetKnownNodes)).toBeInstanceOf(GetKnownNodes);
		expect(container.get(GetKnownNode)).toBeInstanceOf(GetKnownNode);
		expect(container.get(GetKnownOrganizations)).toBeInstanceOf(
			GetKnownOrganizations
		);
		expect(container.get(GetKnownOrganization)).toBeInstanceOf(
			GetKnownOrganization
		);
		expect(container.get(GetFbasAnalysis)).toBeInstanceOf(GetFbasAnalysis);
		expect(container.get(GetFbasAnalysisProof)).toBeInstanceOf(
			GetFbasAnalysisProof
		);
		expect(container.get(GetLatestFbasProofSets)).toBeInstanceOf(
			GetLatestFbasProofSets
		);
		expect(container.get(GetLatestFbas)).toBeInstanceOf(GetLatestFbas);
		expect(container.get(GetTopTierHistory)).toBeInstanceOf(GetTopTierHistory);
		expect(
			container.get<KnownArchiveEvidenceRepository>(
				HISTORY_SCAN_TYPES.KnownArchiveEvidenceRepository
			)
		).toBeInstanceOf(TypeOrmKnownArchiveEvidenceRepository);
		expect(container.get(GetKnownArchiveEvidence)).toBeInstanceOf(
			GetKnownArchiveEvidence
		);
		expect(container.get(GetKnownNodeArchiveEvidence)).toBeInstanceOf(
			GetKnownNodeArchiveEvidence
		);
		expect(container.get(GetKnownOrganizationArchiveEvidence)).toBeInstanceOf(
			GetKnownOrganizationArchiveEvidence
		);
		expect(container.get(GetHistoryArchiveEvidence)).toBeInstanceOf(
			GetHistoryArchiveEvidence
		);

		await kernel.close();
	} finally {
		if (previousDatabaseTestUrl === undefined) {
			delete process.env.DATABASE_TEST_URL;
		} else {
			process.env.DATABASE_TEST_URL = previousDatabaseTestUrl;
		}
		await postgres.stop();
	}
});

import { interfaces } from 'inversify';
import Container = interfaces.Container;
import { DataSource } from 'typeorm';
import type { ScanRepository } from '../../domain/scan/ScanRepository.js';
import { TypeOrmHistoryArchiveScanResultRepository } from '../repositories/database/TypeOrmHistoryArchiveScanResultRepository.js';
import { TYPES } from './di-types.js';
import { Config } from '@core/config/Config.js';
import { GetLatestScan } from '../../use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanLogs } from '../../use-cases/get-scan-logs/GetScanLogs.js';
import { GetScanEvidence } from '../../use-cases/get-scan-evidence/GetScanEvidence.js';
import { Scan } from '../../domain/scan/Scan.js';
import { RegisterScan } from '../../use-cases/register-scan/RegisterScan.js';
import { ScanMapper } from '../mappers/ScanMapper.js';
import { GetScanJob } from '../../use-cases/get-scan-job/GetScanJob.js';
import { ReleaseScanJob } from '../../use-cases/release-scan-job/ReleaseScanJob.js';
import { TouchScanJob } from '../../use-cases/touch-scan-job/TouchScanJob.js';
import { RestartAtLeastOneScan } from '../../domain/ScanScheduler.js';
import type { ScanScheduler } from '../../domain/ScanScheduler.js';
import { ScheduleScanJobs } from '../../use-cases/schedule-scan-jobs/ScheduleScanJobs.js';
import type { ScanJobRepository } from '../../domain/ScanJobRepository.js';
import { TypeOrmScanJobRepository } from '../repositories/database/TypeOrmScanJobRepository.js';
import { ScanJob } from '../../domain/ScanJob.js';
import { GetArchiveScans } from '../../use-cases/get-archive-scans/GetArchiveScans.js';
import { GetArchiveScanQueue } from '../../use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetArchiveScanWorkers } from '../../use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { CommunityScanner } from '../database/entities/CommunityScanner.js';
import { GetScannerMetrics } from '../../use-cases/GetScannerMetrics.js';
import { RegisterCommunityScanner } from '../../use-cases/RegisterCommunityScanner.js';
import { SendScannerHeartbeat } from '../../use-cases/SendScannerHeartbeat.js';
import type { CommunityScannerRegistrationThrottleRepository } from '../../domain/CommunityScannerRegistrationThrottle.js';
import { TypeOrmCommunityScannerRegistrationThrottleRepository } from '../repositories/database/TypeOrmCommunityScannerRegistrationThrottleRepository.js';
import { RegisterParsedLedgerHeaders } from '../../use-cases/register-parsed-ledger-headers/RegisterParsedLedgerHeaders.js';
import type { ParsedLedgerHeaderRepository } from '../../domain/parsed-history/ParsedLedgerHeaderRepository.js';
import { TypeOrmParsedLedgerHeaderRepository } from '../repositories/database/TypeOrmParsedLedgerHeaderRepository.js';
import { ParsedLedgerHeader } from '../database/entities/ParsedLedgerHeader.js';
import { RegisterParsedTransactionEnvelopes } from '../../use-cases/register-parsed-transaction-envelopes/RegisterParsedTransactionEnvelopes.js';
import { RegisterParsedTransactionResults } from '../../use-cases/register-parsed-transaction-results/RegisterParsedTransactionResults.js';
import type { ParsedTransactionEnvelopeRepository } from '../../domain/parsed-history/ParsedTransactionEnvelopeRepository.js';
import type { ParsedTransactionResultRepository } from '../../domain/parsed-history/ParsedTransactionResultRepository.js';
import { TypeOrmParsedTransactionEnvelopeRepository } from '../repositories/database/TypeOrmParsedTransactionEnvelopeRepository.js';
import { TypeOrmParsedTransactionResultRepository } from '../repositories/database/TypeOrmParsedTransactionResultRepository.js';
import { ParsedTransactionEnvelope } from '../database/entities/ParsedTransactionEnvelope.js';
import { ParsedTransactionResult } from '../database/entities/ParsedTransactionResult.js';
import { BackfillArchiveMetadata } from '../../use-cases/backfill-archive-metadata/BackfillArchiveMetadata.js';
import type { HistoryArchiveStateRepository } from '../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import { TypeOrmHistoryArchiveStateRepository } from '../repositories/database/TypeOrmHistoryArchiveStateRepository.js';
import { HistoryArchiveStateSnapshot } from '../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import { GetHistoryArchiveState } from '../../use-cases/get-history-archive-state/GetHistoryArchiveState.js';
import { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { HistoryArchiveObjectEvent } from '../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import type { HistoryArchiveObjectEventRepository } from '../../domain/history-archive-object/HistoryArchiveObjectEventRepository.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../repositories/database/TypeOrmHistoryArchiveObjectRepository.js';
import { TypeOrmHistoryArchiveObjectEventRepository } from '../repositories/database/TypeOrmHistoryArchiveObjectEventRepository.js';
import { TypeOrmHistoryArchiveCheckpointProofRepository } from '../repositories/database/TypeOrmHistoryArchiveCheckpointProofRepository.js';
import { GetHistoryArchiveObjects } from '../../use-cases/get-history-archive-objects/GetHistoryArchiveObjects.js';
import { GetHistoryArchiveBucketCoverage } from '../../use-cases/get-history-archive-bucket-coverage/GetHistoryArchiveBucketCoverage.js';
import { GetHistoryArchiveObjectSummary } from '../../use-cases/get-history-archive-object-summary/GetHistoryArchiveObjectSummary.js';
import { GetHistoryArchiveObjectStatusSummary } from '../../use-cases/get-history-archive-object-status-summary/GetHistoryArchiveObjectStatusSummary.js';
import { GetHistoryArchiveObjectEvents } from '../../use-cases/get-history-archive-object-events/GetHistoryArchiveObjectEvents.js';
import { GetHistoryArchiveRepairPlan } from '../../use-cases/get-history-archive-repair-plan/GetHistoryArchiveRepairPlan.js';
import { ScheduleHistoryArchiveObjects } from '../../use-cases/schedule-history-archive-objects/ScheduleHistoryArchiveObjects.js';
import { GetHistoryArchiveObjectJob } from '../../use-cases/get-history-archive-object-job/GetHistoryArchiveObjectJob.js';
import { TouchHistoryArchiveObject } from '../../use-cases/touch-history-archive-object/TouchHistoryArchiveObject.js';
import { CompleteHistoryArchiveObject } from '../../use-cases/complete-history-archive-object/CompleteHistoryArchiveObject.js';
import { FailHistoryArchiveObject } from '../../use-cases/fail-history-archive-object/FailHistoryArchiveObject.js';
import { ReconcileHistoryArchiveObjectTransitions } from '../../use-cases/reconcile-history-archive-object-transitions/ReconcileHistoryArchiveObjectTransitions.js';
import { ReleaseHistoryArchiveObject } from '../../use-cases/release-history-archive-object/ReleaseHistoryArchiveObject.js';
import { HistoryArchiveObjectEventRecorder } from '../../use-cases/record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { ReportHistoryArchiveWorkerStatus } from '../../use-cases/report-history-archive-worker-status/ReportHistoryArchiveWorkerStatus.js';
import type { HistoryArchiveWorkerStatusRepository } from '../../domain/history-archive-worker/HistoryArchiveWorkerStatus.js';
import { HistoryArchiveWorkerStatusRow } from '../database/entities/HistoryArchiveWorkerStatusRow.js';
import { TypeOrmHistoryArchiveWorkerStatusRepository } from '../repositories/database/TypeOrmHistoryArchiveWorkerStatusRepository.js';
import type { KnownArchiveEvidenceRepository } from '../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { TypeOrmKnownArchiveEvidenceRepository } from '../repositories/database/TypeOrmKnownArchiveEvidenceRepository.js';
import { GetKnownArchiveEvidence } from '../../use-cases/get-known-archive-evidence/GetKnownArchiveEvidence.js';
import { GetKnownNodeArchiveEvidence } from '../../use-cases/get-known-node-archive-evidence/GetKnownNodeArchiveEvidence.js';
import { GetKnownOrganizationArchiveEvidence } from '../../use-cases/get-known-organization-archive-evidence/GetKnownOrganizationArchiveEvidence.js';
import { GetHistoryArchiveEvidence } from '../../use-cases/get-history-archive-evidence/GetHistoryArchiveEvidence.js';
import {
	ArchiveEvidenceCursorCodec,
	createArchiveEvidenceCursorCodec
} from '../../use-cases/get-known-archive-evidence/ArchiveEvidenceCursorCodec.js';
import type { FullHistoryCanonicalRepository } from '../../domain/full-history/FullHistoryCanonicalRepository.js';
import type { FullHistoryPromotionRuntimeRepository } from '../../domain/full-history-promotion/FullHistoryPromotionRuntimeRepository.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../database/full-history/TypeOrmFullHistoryCanonicalRepository.js';
import { TypeOrmFullHistoryPromotionRuntimeRepository } from '../database/full-history-promotion/TypeOrmFullHistoryPromotionRuntimeRepository.js';

export function load(container: Container, config: Config) {
	const dataSource = container.get(DataSource);
	container
		.bind<ArchiveEvidenceCursorCodec>(TYPES.ArchiveEvidenceCursorCodec)
		.toConstantValue(
			createArchiveEvidenceCursorCodec({
				encodedKeys: process.env.ARCHIVE_EVIDENCE_CURSOR_KEYS,
				nodeEnv: config.nodeEnv
			})
		);
	container.bind(GetLatestScan).toSelf();
	container.bind(GetScanLogs).toSelf();
	container.bind(GetScanEvidence).toSelf();
	container.bind(GetScanJob).toSelf();
	container.bind(GetArchiveScans).toSelf();
	container.bind(GetArchiveScanQueue).toSelf();
	container.bind(GetArchiveScanWorkers).toSelf();
	container.bind(GetHistoryArchiveState).toSelf();
	container.bind(GetHistoryArchiveBucketCoverage).toSelf();
	container.bind(GetHistoryArchiveObjects).toSelf();
	container.bind(GetHistoryArchiveObjectSummary).toSelf();
	container.bind(GetHistoryArchiveObjectStatusSummary).toSelf();
	container.bind(GetHistoryArchiveObjectEvents).toSelf();
	container.bind(GetHistoryArchiveRepairPlan).toSelf();
	container.bind(GetKnownArchiveEvidence).toSelf();
	container.bind(GetKnownNodeArchiveEvidence).toSelf();
	container.bind(GetKnownOrganizationArchiveEvidence).toSelf();
	container.bind(GetHistoryArchiveEvidence).toSelf();
	container.bind(GetHistoryArchiveObjectJob).toSelf();
	container.bind(GetScannerMetrics).toSelf();
	container.bind(BackfillArchiveMetadata).toSelf();
	container.bind(RegisterCommunityScanner).toSelf();
	container.bind(SendScannerHeartbeat).toSelf();
	container.bind(TouchHistoryArchiveObject).toSelf();
	container.bind(CompleteHistoryArchiveObject).toSelf();
	container.bind(FailHistoryArchiveObject).toSelf();
	container.bind(ReleaseHistoryArchiveObject).toSelf();
	container.bind(HistoryArchiveObjectEventRecorder).toSelf();
	container
		.bind(ReconcileHistoryArchiveObjectTransitions)
		.toSelf()
		.inSingletonScope();
	container.bind(ReportHistoryArchiveWorkerStatus).toSelf();
	container.bind(TouchScanJob).toSelf();
	container.bind(ReleaseScanJob).toSelf();
	container.bind(RegisterScan).toSelf();
	container.bind(RegisterParsedLedgerHeaders).toSelf();
	container.bind(RegisterParsedTransactionEnvelopes).toSelf();
	container.bind(RegisterParsedTransactionResults).toSelf();
	container.bind(ScheduleHistoryArchiveObjects).toSelf();
	container.bind(ScheduleScanJobs).toSelf();
	container.bind<ScanScheduler>(TYPES.ScanScheduler).toDynamicValue(() => {
		return new RestartAtLeastOneScan();
	});
	container.bind(ScanMapper).toSelf();
	container
		.bind<ScanJobRepository>(TYPES.ScanJobRepository)
		.toDynamicValue(() => {
			return new TypeOrmScanJobRepository(dataSource.getRepository(ScanJob));
		})
		.inRequestScope();

	container
		.bind(TYPES.CommunityScannerRepository)
		.toDynamicValue(() => {
			return dataSource.getRepository(CommunityScanner);
		})
		.inRequestScope();

	container
		.bind<CommunityScannerRegistrationThrottleRepository>(
			TYPES.CommunityScannerRegistrationThrottleRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmCommunityScannerRegistrationThrottleRepository(
				dataSource
			);
		})
		.inRequestScope();

	container
		.bind<ScanRepository>(TYPES.HistoryArchiveScanRepository)
		.toDynamicValue(() => {
			return new TypeOrmHistoryArchiveScanResultRepository(
				dataSource.getRepository(Scan)
			);
		})
		.inRequestScope();

	container
		.bind<HistoryArchiveStateRepository>(TYPES.HistoryArchiveStateRepository)
		.toDynamicValue(() => {
			return new TypeOrmHistoryArchiveStateRepository(
				dataSource.getRepository(HistoryArchiveStateSnapshot)
			);
		})
		.inRequestScope();

	container
		.bind<HistoryArchiveObjectRepository>(TYPES.HistoryArchiveObjectRepository)
		.toDynamicValue(() => {
			return new TypeOrmHistoryArchiveObjectRepository(
				dataSource.getRepository(HistoryArchiveObject)
			);
		})
		.inRequestScope();

	container
		.bind<HistoryArchiveObjectEventRepository>(
			TYPES.HistoryArchiveObjectEventRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmHistoryArchiveObjectEventRepository(
				dataSource.getRepository(HistoryArchiveObjectEvent)
			);
		})
		.inRequestScope();

	container
		.bind<HistoryArchiveCheckpointProofRepository>(
			TYPES.HistoryArchiveCheckpointProofRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmHistoryArchiveCheckpointProofRepository(dataSource);
		})
		.inRequestScope();

	container
		.bind<HistoryArchiveWorkerStatusRepository>(
			TYPES.HistoryArchiveWorkerStatusRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmHistoryArchiveWorkerStatusRepository(
				dataSource.getRepository(HistoryArchiveWorkerStatusRow)
			);
		})
		.inRequestScope();

	container
		.bind<KnownArchiveEvidenceRepository>(TYPES.KnownArchiveEvidenceRepository)
		.toDynamicValue(() => new TypeOrmKnownArchiveEvidenceRepository(dataSource))
		.inRequestScope();

	container
		.bind<FullHistoryCanonicalRepository>(TYPES.FullHistoryCanonicalRepository)
		.toDynamicValue(() => new TypeOrmFullHistoryCanonicalRepository(dataSource))
		.inRequestScope();

	container
		.bind<FullHistoryPromotionRuntimeRepository>(
			TYPES.FullHistoryPromotionRuntimeRepository
		)
		.toDynamicValue(
			() => new TypeOrmFullHistoryPromotionRuntimeRepository(dataSource)
		)
		.inRequestScope();

	container
		.bind<ParsedLedgerHeaderRepository>(TYPES.ParsedLedgerHeaderRepository)
		.toDynamicValue(() => {
			return new TypeOrmParsedLedgerHeaderRepository(
				dataSource.getRepository(ParsedLedgerHeader)
			);
		})
		.inRequestScope();

	container
		.bind<ParsedTransactionEnvelopeRepository>(
			TYPES.ParsedTransactionEnvelopeRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmParsedTransactionEnvelopeRepository(
				dataSource.getRepository(ParsedTransactionEnvelope)
			);
		})
		.inRequestScope();

	container
		.bind<ParsedTransactionResultRepository>(
			TYPES.ParsedTransactionResultRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmParsedTransactionResultRepository(
				dataSource.getRepository(ParsedTransactionResult)
			);
		})
		.inRequestScope();
}

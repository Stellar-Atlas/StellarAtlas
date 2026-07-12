import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { HistoryArchiveWorkerStatusMigration1784790000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1784790000000-HistoryArchiveWorkerStatusMigration.js';
import { HistoryArchiveStatusSummaryIndexesMigration1784800000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1784800000000-HistoryArchiveStatusSummaryIndexesMigration.js';
import { HistoryArchiveSchedulerOnlineIndexesMigration1784810000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1784810000000-HistoryArchiveSchedulerOnlineIndexesMigration.js';
import { HistoryArchiveFailureChannelMigration1784820000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1784820000000-HistoryArchiveFailureChannelMigration.js';
import { HistoryArchiveCheckpointProofRollupMigration1784830000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1784830000000-HistoryArchiveCheckpointProofRollupMigration.js';
import { ParsedLedgerClosedAtMigration1784840000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1784840000000-ParsedLedgerClosedAtMigration.js';
import { ParsedHistoryObservationMigration1784850000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1784850000000-ParsedHistoryObservationMigration.js';
import { FullHistoryCanonicalSchemaMigration1784860000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1784860000000-FullHistoryCanonicalSchemaMigration.js';
import { HistoryArchiveCheckpointProofPredecessorFailureMigration1784870000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1784870000000-HistoryArchiveCheckpointProofPredecessorFailureMigration.js';
import { OrganizationTomlEvidenceMigration1784795000000 } from '@network-scan/infrastructure/database/migrations/1784795000000-OrganizationTomlEvidenceMigration.js';
import { ScpLiveCanonicalTailMigration1784800000000 } from '@network-scan/infrastructure/database/migrations/1784800000000-ScpLiveCanonicalTailMigration.js';

// The production database was imported with a partial legacy migration ledger.
// Explicit registration prevents TypeORM from replaying pre-baseline migrations.
export const managedMigrations = [
	HistoryArchiveObjectClaimCursorMigration1784780000000,
	HistoryArchiveWorkerStatusMigration1784790000000,
	OrganizationTomlEvidenceMigration1784795000000,
	ScpLiveCanonicalTailMigration1784800000000,
	HistoryArchiveStatusSummaryIndexesMigration1784800000000,
	HistoryArchiveSchedulerOnlineIndexesMigration1784810000000,
	HistoryArchiveFailureChannelMigration1784820000000,
	HistoryArchiveCheckpointProofRollupMigration1784830000000,
	ParsedLedgerClosedAtMigration1784840000000,
	ParsedHistoryObservationMigration1784850000000,
	FullHistoryCanonicalSchemaMigration1784860000000,
	HistoryArchiveCheckpointProofPredecessorFailureMigration1784870000000
] as const;

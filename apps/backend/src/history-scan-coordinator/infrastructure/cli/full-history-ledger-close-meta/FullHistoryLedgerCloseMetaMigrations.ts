import { managedMigrations } from '@core/infrastructure/database/ManagedMigrations.js';
import { AtlasAccountVerification1794091000000 } from '@core/infrastructure/database/migrations/1794091000000-AtlasAccountVerification.js';
import { AtlasDeveloperAuthentication1794232800000 } from '@core/infrastructure/database/migrations/1794232800000-AtlasDeveloperAuthentication.js';
import { AtlasVerificationAuthentication1794092000000 } from '@core/infrastructure/database/migrations/1794092000000-AtlasVerificationAuthentication.js';
import { HistoryArchiveHeaderProofRepairQueueKindMigration1793384400000 } from '../../database/migrations/1793384400000-HistoryArchiveHeaderProofRepairQueueKindMigration.js';

// These independent features do not change this producer's schema contract.
// Retain every other migration, including all ingestion and inventory migrations.
export const fullHistoryLedgerCloseMetaMigrations = managedMigrations.filter(
	(migration) =>
		migration !== HistoryArchiveHeaderProofRepairQueueKindMigration1793384400000 &&
		migration !== AtlasAccountVerification1794091000000 &&
		migration !== AtlasDeveloperAuthentication1794232800000 &&
		migration !== AtlasVerificationAuthentication1794092000000
);

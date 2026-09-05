import {
	historyArchiveCheckpointProofStatementAttestationDownSql,
	historyArchiveCheckpointProofStatementAttestationUpSql
} from '../1788587936000-HistoryArchiveCheckpointProofStatementAttestationMigration.js';

describe('HistoryArchiveCheckpointProofStatementAttestationMigration', () => {
	it('captures proof and durable-rollup rows once per SQL statement', () => {
		expect(historyArchiveCheckpointProofStatementAttestationUpSql).toContain(
			'referencing new table as new_proofs'
		);
		expect(historyArchiveCheckpointProofStatementAttestationUpSql).toContain(
			'referencing new table as new_attestations'
		);
		expect(historyArchiveCheckpointProofStatementAttestationUpSql).toContain(
			'from new_proofs proof'
		);
		expect(historyArchiveCheckpointProofStatementAttestationUpSql).toContain(
			'from new_attestations attestation'
		);
		expect(historyArchiveCheckpointProofStatementAttestationUpSql).toContain(
			'select distinct'
		);
		expect(
			historyArchiveCheckpointProofStatementAttestationUpSql
		).not.toContain(
			'for each row execute function "capture_history_archive_checkpoint_proof_attestation"'
		);
	});

	it('restores the original row triggers on rollback', () => {
		expect(historyArchiveCheckpointProofStatementAttestationDownSql).toContain(
			'for each row execute function "capture_history_archive_checkpoint_proof_attestation"'
		);
		expect(historyArchiveCheckpointProofStatementAttestationDownSql).toContain(
			'perform "record_history_archive_checkpoint_proof_attestation"(new)'
		);
	});
});

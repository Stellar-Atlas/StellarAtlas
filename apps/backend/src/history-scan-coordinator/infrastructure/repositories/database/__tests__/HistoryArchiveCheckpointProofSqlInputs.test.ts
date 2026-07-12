import { toHistoryArchiveCheckpointProofRefreshParams } from '../HistoryArchiveCheckpointProofSqlInputs.js';
import { historyArchiveCheckpointProofRefreshSql } from '../HistoryArchiveCheckpointProofRefreshSql.js';

describe('HistoryArchiveCheckpointProofSqlInputs', () => {
	it('maps missing optional proof refresh target fields to null', () => {
		expect(
			toHistoryArchiveCheckpointProofRefreshParams({
				archiveUrlIdentity: 'https://history.example.com'
			})
		).toEqual(['https://history.example.com', null, null]);
	});

	it('preserves checkpoint ledger and bucket hash refresh targets', () => {
		expect(
			toHistoryArchiveCheckpointProofRefreshParams({
				archiveUrlIdentity: 'https://history.example.com',
				bucketHash:
					'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
				checkpointLedger: 127
			})
		).toEqual([
			'https://history.example.com',
			127,
			'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
		]);
	});

	it('keeps refresh checkpoint-local and dependency-local', () => {
		expect(historyArchiveCheckpointProofRefreshSql).toContain(
			'"history_archive_checkpoint_bucket_dependency"'
		);
		expect(historyArchiveCheckpointProofRefreshSql).toContain(
			'$2::integer + 64'
		);
		expect(historyArchiveCheckpointProofRefreshSql).not.toContain(
			'"archiveUrlIdentity" in ('
		);
	});
});

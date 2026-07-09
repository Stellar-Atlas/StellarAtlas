import {
	archiveObjectFilterSql,
	toHistoryArchiveCheckpointProofRefreshParams
} from '../HistoryArchiveCheckpointProofSqlInputs.js';

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

	it('keeps archive object proof refresh scoped to one archive identity', () => {
		expect(archiveObjectFilterSql).toContain('"archiveUrlIdentity" = $1::text');
		expect(archiveObjectFilterSql).toContain('"checkpointLedger" is not null');
	});
});

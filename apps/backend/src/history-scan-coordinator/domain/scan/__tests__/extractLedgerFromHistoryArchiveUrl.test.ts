import { extractLedgerFromHistoryArchiveUrl } from '../extractLedgerFromHistoryArchiveUrl';

it('extracts category ledger numbers from archive urls', () => {
	expect(
		extractLedgerFromHistoryArchiveUrl(
			'https://history.example/transactions/03/80/a5/transactions-0380a53f.xdr.gz'
		)
	).toEqual(58762559);
	expect(
		extractLedgerFromHistoryArchiveUrl(
			'https://history.example/history/00/00/77/history-000077bf.json'
		)
	).toEqual(30655);
});

it('returns null for bucket urls and non archive urls', () => {
	expect(
		extractLedgerFromHistoryArchiveUrl(
			'https://history.example/bucket/aa/bb/cc/bucket-aabbcc.xdr.gz'
		)
	).toBeNull();
	expect(
		extractLedgerFromHistoryArchiveUrl('https://history.example')
	).toBeNull();
});

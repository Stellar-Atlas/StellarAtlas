import {
	appendHistoryArchiveRootPath,
	normalizeHistoryArchiveRootUrl
} from '../src/history-archive-url.js';

describe('normalizeHistoryArchiveRootUrl', () => {
	it('normalizes archive roots and trims trailing slashes', () => {
		expect(
			normalizeHistoryArchiveRootUrl(
				' https://history.example.com/archive/path/// '
			)
		).toBe('https://history.example.com/archive/path');
	});

	it('strips a root history archive state URL to its archive root', () => {
		expect(
			normalizeHistoryArchiveRootUrl(
				'https://history.example.com/archive/.well-known/stellar-history.json'
			)
		).toBe('https://history.example.com/archive');
	});

	it('does not reject valid roots that contain history as a normal path segment', () => {
		expect(
			normalizeHistoryArchiveRootUrl(
				'https://stellar-validator-mainnet.s3.us-east-1.amazonaws.com/history/validator-01'
			)
		).toBe(
			'https://stellar-validator-mainnet.s3.us-east-1.amazonaws.com/history/validator-01'
		);
	});

	it('rejects archive object URLs', () => {
		expect(
			normalizeHistoryArchiveRootUrl(
				'https://history.example.com/archive/history/00/00/00/history-0000003f.json'
			)
		).toBeNull();
		expect(
			normalizeHistoryArchiveRootUrl(
				'https://history.example.com/archive/bucket/aa/bb/cc/bucket-aabbcc.xdr.gz'
			)
		).toBeNull();
		expect(
			normalizeHistoryArchiveRootUrl(
				'https://history.example.com/archive/scp/00/12/86/scp-0012867f.xdr.gz'
			)
		).toBeNull();
	});

	it('preserves case-sensitive path and query data while normalizing the origin', () => {
		expect(
			normalizeHistoryArchiveRootUrl(
				'HTTPS://History.Example.COM/Archive/Case?Token=AbC%2F123'
			)
		).toBe('https://history.example.com/Archive/Case?Token=AbC%2F123');
		expect(
			appendHistoryArchiveRootPath(
				'https://history.example.com/Archive?Token=AbC',
				'ledger/00/00/00/ledger-0000003f.xdr.gz'
			)
		).toBe(
			'https://history.example.com/Archive/ledger/00/00/00/ledger-0000003f.xdr.gz?Token=AbC'
		);
	});

	it('rejects URLs with credentials, hashes, or unsupported protocols', () => {
		expect(
			normalizeHistoryArchiveRootUrl('ftp://history.example.com')
		).toBeNull();
		expect(
			normalizeHistoryArchiveRootUrl('https://user@history.example.com')
		).toBeNull();
		expect(
			normalizeHistoryArchiveRootUrl('https://history.example.com#state')
		).toBeNull();
	});
});

import {
	getHistoryArchiveUrlIdentity,
	getPublicHistoryArchiveUrlIdentity,
	parseHistoryArchiveUrl,
	uniqueHistoryArchiveUrls
} from '../ArchiveUrlIdentity.js';

describe('ArchiveUrlIdentity', () => {
	it('normalizes history archive state URLs to their archive root', () => {
		expect(
			parseHistoryArchiveUrl(
				'https://history.example.com/archive/.well-known/stellar-history.json'
			)
		).toBe('https://history.example.com/archive');
		expect(
			getHistoryArchiveUrlIdentity(
				'https://HISTORY.example.com/archive/.well-known/stellar-history.json'
			)
		).toBe('https://history.example.com/archive');
	});

	it('rejects checkpoint and bucket object URLs as archive roots', () => {
		expect(
			parseHistoryArchiveUrl(
				'https://history.example.com/archive/history/00/00/00/history-0000003f.json'
			)
		).toBeNull();
		expect(
			parseHistoryArchiveUrl(
				'https://history.example.com/archive/bucket/aa/bb/cc/bucket-aabbcc.xdr.gz'
			)
		).toBeNull();
	});

	it('deduplicates root variants without preserving malformed file roots', () => {
		expect(
			uniqueHistoryArchiveUrls([
				'https://history.example.com/archive/',
				'https://history.example.com/archive/.well-known/stellar-history.json',
				'https://history.example.com/archive/history/00/00/00/history-0000003f.json'
			])
		).toEqual(['https://history.example.com/archive']);
	});

	it('keeps same-host archive paths as distinct archive identities', () => {
		expect(
			getHistoryArchiveUrlIdentity('https://history.example.com/archive-a')
		).toBe('https://history.example.com/archive-a');
		expect(
			getHistoryArchiveUrlIdentity('https://history.example.com/archive-b')
		).toBe('https://history.example.com/archive-b');
	});

	it('preserves case-sensitive path and query identity data', () => {
		expect(
			getHistoryArchiveUrlIdentity(
				'HTTPS://History.Example.COM/Archive/Case?Token=AbC'
			)
		).toBe('https://history.example.com/Archive/Case?Token=AbC');
		expect(
			getHistoryArchiveUrlIdentity(
				'https://history.example.com/archive/case?Token=abc'
			)
		).not.toBe('https://history.example.com/Archive/Case?Token=AbC');
	});

	it('removes credentials and query data from public identities', () => {
		expect(
			getPublicHistoryArchiveUrlIdentity(
				'https://history.example.com/Archive/Case?Token=secret#ignored'
			)
		).toBe('[redacted]');
		expect(
			getPublicHistoryArchiveUrlIdentity(
				'https://history.example.com/Archive/Case?Token=secret'
			)
		).toBe('history.example.com/Archive/Case');
		expect(
			getPublicHistoryArchiveUrlIdentity('history.example.com/v2?Token=secret')
		).toBe('history.example.com/v2');
		expect(
			getPublicHistoryArchiveUrlIdentity(
				'https://operator:secret@history.example.com/archive'
			)
		).toBe('[redacted]');
	});
});

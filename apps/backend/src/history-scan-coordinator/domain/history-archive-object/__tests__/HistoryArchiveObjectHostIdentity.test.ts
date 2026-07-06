import { getHistoryArchiveObjectHostIdentity } from '../HistoryArchiveObjectHostIdentity.js';

describe('HistoryArchiveObjectHostIdentity', () => {
	it.each([
		['https://archive.v1.stellar.lobstr.co', 'archive.v1.stellar.lobstr.co'],
		['http://history.example.org:11625/root', 'history.example.org:11625'],
		[' HTTPS://Archive.Example.Org/.well-known/stellar-history.json ', 'archive.example.org'],
		['not a url', 'not a url']
	])('normalizes %s to %s', (archiveUrl, hostIdentity) => {
		expect(getHistoryArchiveObjectHostIdentity(archiveUrl)).toBe(hostIdentity);
	});
});

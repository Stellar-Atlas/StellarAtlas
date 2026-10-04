import {
	excludedHistoryArchiveHosts,
	historyArchiveScanEnabled,
	historyArchiveHostScanAllowedSql
} from '../HistoryArchiveScanPolicy.js';

describe('operator archive scan exclusions', () => {
	const before = process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS;
	afterEach(() => {
		if (before === undefined) delete process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS;
		else process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS = before;
	});
	it('defaults to permitting roots and only excludes exact configured hosts', () => {
		delete process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS;
		expect(historyArchiveScanEnabled('https://archive.example/a')).toBe(true);
		process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS =
			'ARCHIVE.example,archive.example';
		expect(excludedHistoryArchiveHosts()).toEqual(['archive.example']);
		expect(historyArchiveScanEnabled('https://archive.example/a')).toBe(false);
		expect(historyArchiveScanEnabled('http://archive.example/b')).toBe(false);
		expect(historyArchiveScanEnabled('https://other.archive.example/a')).toBe(
			true
		);
		expect(historyArchiveHostScanAllowedSql('candidate')).toContain(
			'candidate."hostIdentity" not in (\'archive.example\')'
		);
	});
	it('rejects malformed operator input instead of interpolating it into SQL', () => {
		process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS =
			"archive.example');select 1;--";
		expect(() => historyArchiveHostScanAllowedSql('candidate')).toThrow(
			'Invalid HISTORY_ARCHIVE_EXCLUDED_HOSTS'
		);
		expect(() => historyArchiveHostScanAllowedSql('candidate;')).toThrow(
			'Invalid scan policy SQL alias'
		);
	});
});

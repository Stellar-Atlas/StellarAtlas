/// <reference types="jest" />

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicHistoryArchiveScanLogEntry } from '@api/types';
import { HistoryArchiveScanLog } from '../history-archive-scan-log';

describe('HistoryArchiveScanLog', () => {
	it('quarantines and paginates retained range evidence', () => {
		const logs = Array.from({ length: 12 }, (_, index) => createLog(index));
		const html = renderToStaticMarkup(
			createElement(HistoryArchiveScanLog, { logs })
		);

		expect(html).toContain('Historical range-scan evidence');
		expect(html).toContain('historical review only');
		expect(html).toContain(
			'do not represent current archive health, object work, or scanner runtime'
		);
		expect(html).toContain('Page 1 of 2');
		expect(html).toMatch(
			/^<details class="metadata-document legacy-range-evidence"><summary>/
		);
	});
});

function createLog(index: number): PublicHistoryArchiveScanLogEntry {
	return {
		concurrency: 1,
		durationMs: 1_000,
		endDate: '2026-07-10T10:01:00.000Z',
		errors: [],
		fromLedger: index * 64,
		hasError: false,
		isSlowArchive: false,
		latestScannedLedger: index * 64 + 63,
		latestVerifiedLedger: index * 64 + 63,
		startDate: '2026-07-10T10:00:00.000Z',
		status: 'scanning',
		toLedger: index * 64 + 63,
		updatedAt: `2026-07-10T10:${index.toString().padStart(2, '0')}:00.000Z`,
		url: 'https://archive.example'
	};
}

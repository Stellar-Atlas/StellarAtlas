import { isHistoryArchiveWorkerReportDTO } from '../HistoryArchiveWorkerStatusDTO.js';

describe('HistoryArchiveWorkerStatusDTO', () => {
	it('accepts compact active and idle worker reports', () => {
		expect(isHistoryArchiveWorkerReportDTO(createReport())).toBe(true);
		expect(
			isHistoryArchiveWorkerReportDTO({
				...createReport(),
				bytesDownloaded: null,
				bytesTotal: null,
				claimAttempt: null,
				currentObject: null,
				lastOutcome: 'verified',
				lastOutcomeAt: '2026-07-10T12:01:00.000Z',
				stage: 'idle'
			})
		).toBe(true);
	});

	it('accepts an omitted transfer total and rejects invalid slot or byte totals', () => {
		const { bytesTotal: _bytesTotal, ...withoutBytesTotal } = createReport();
		expect(isHistoryArchiveWorkerReportDTO(withoutBytesTotal)).toBe(true);
		expect(
			isHistoryArchiveWorkerReportDTO({ ...createReport(), slotIndex: 24 })
		).toBe(false);
		expect(
			isHistoryArchiveWorkerReportDTO({ ...createReport(), bytesTotal: -1 })
		).toBe(false);
	});

	it('rejects free-form stages and archive failure details', () => {
		expect(
			isHistoryArchiveWorkerReportDTO({
				...createReport(),
				stage: 'running arbitrary operator command'
			})
		).toBe(false);
		expect(
			isHistoryArchiveWorkerReportDTO({
				...createReport(),
				errorMessage: 'remote response body'
			})
		).toBe(false);
	});

	it('rejects inconsistent idle and active reports', () => {
		expect(
			isHistoryArchiveWorkerReportDTO({
				...createReport(),
				currentObject: null,
				stage: 'claimed'
			})
		).toBe(false);
		expect(
			isHistoryArchiveWorkerReportDTO({
				...createReport(),
				claimAttempt: null
			})
		).toBe(false);
		expect(
			isHistoryArchiveWorkerReportDTO({
				...createReport(),
				lastOutcome: 'verified',
				lastOutcomeAt: null
			})
		).toBe(false);
	});

	it('rejects filesystem paths and credential-bearing archive sources', () => {
		for (const source of [
			'/srv/archive/private',
			'file:///srv/archive/private',
			'https://operator:secret@archive.example'
		]) {
			expect(
				isHistoryArchiveWorkerReportDTO({
					...createReport(),
					currentObject: { ...createReport().currentObject, source }
				})
			).toBe(false);
		}
	});
});

function createReport() {
	return {
		bytesDownloaded: 1024,
		bytesTotal: 4096,
		claimAttempt: 3,
		currentObject: {
			remoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
			source: 'https://archive.example',
			type: 'bucket'
		},
		lastOutcome: 'none',
		lastOutcomeAt: null,
		pid: 4123,
		processGeneration: 1,
		processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
		processStartedAt: '2026-07-10T12:00:00.000Z',
		sequence: 8,
		slotIndex: 17,
		stage: 'downloading_bucket',
		workerId: 'object-a1b2c3d4-0-0'
	};
}

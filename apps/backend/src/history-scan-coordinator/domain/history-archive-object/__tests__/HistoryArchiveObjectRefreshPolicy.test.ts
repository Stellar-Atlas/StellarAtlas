import {
	getHistoryArchiveStateRefreshBefore,
	getRefreshableHistoryArchiveStateArchiveIdentities,
	historyArchiveStateRefreshAgeMs
} from '../HistoryArchiveObjectRefreshPolicy.js';

describe('HistoryArchiveObjectRefreshPolicy', () => {
	it('selects only root history archive state objects for refresh', () => {
		const identities = getRefreshableHistoryArchiveStateArchiveIdentities([
			{
				archiveUrlIdentity: 'https://a.example',
				objectKey: 'root',
				objectType: 'history-archive-state'
			},
			{
				archiveUrlIdentity: 'https://a.example',
				objectKey: 'root',
				objectType: 'history-archive-state'
			},
			{
				archiveUrlIdentity: 'https://b.example',
				objectKey: 'history:0000003f',
				objectType: 'checkpoint-state'
			},
			{
				archiveUrlIdentity: 'https://c.example',
				objectKey: 'bucket:abcdef',
				objectType: 'bucket'
			}
		]);

		expect(identities).toEqual(['https://a.example']);
	});

	it('uses the root state refresh age as a scheduling cutoff', () => {
		const now = new Date('2026-07-06T13:30:00.000Z');

		expect(getHistoryArchiveStateRefreshBefore(now)).toEqual(
			new Date(now.getTime() - historyArchiveStateRefreshAgeMs)
		);
	});
});

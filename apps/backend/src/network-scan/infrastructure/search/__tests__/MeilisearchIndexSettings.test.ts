import {
	ensureMeilisearchSettings,
	meilisearchSettingsMatch
} from '../MeilisearchIndexSettings.js';

const expectedSettings = {
	filterableAttributes: ['entityType', 'networkTime'],
	searchableAttributes: ['label', 'content'],
	sortableAttributes: ['label']
} as const;

describe('MeilisearchIndexSettings', () => {
	it('matches expected attributes regardless of Meilisearch response order', () => {
		expect(
			meilisearchSettingsMatch(
				{
					filterableAttributes: ['networkTime', 'entityType'],
					searchableAttributes: ['content', 'label'],
					sortableAttributes: ['label']
				},
				expectedSettings
			)
		).toBe(true);
	});

	it('does not enqueue a settings task when settings already match', async () => {
		const waitTask = jest.fn(async () => ({ status: 'succeeded' }));
		const index = {
			getSettings: jest.fn(async () => ({
				filterableAttributes: ['networkTime', 'entityType'],
				searchableAttributes: ['content', 'label'],
				sortableAttributes: ['label']
			})),
			updateSettings: jest.fn(() => ({ waitTask }))
		};

		await ensureMeilisearchSettings(index, expectedSettings, {
			interval: 1,
			timeout: 1
		});

		expect(index.updateSettings).not.toHaveBeenCalled();
		expect(waitTask).not.toHaveBeenCalled();
	});

	it('enqueues a settings task when settings do not match', async () => {
		const waitTask = jest.fn(async () => ({ status: 'succeeded' }));
		const index = {
			getSettings: jest.fn(async () => ({
				filterableAttributes: ['entityType'],
				searchableAttributes: ['label'],
				sortableAttributes: []
			})),
			updateSettings: jest.fn(() => ({ waitTask }))
		};

		await ensureMeilisearchSettings(index, expectedSettings, {
			interval: 1,
			timeout: 1
		});

		expect(index.updateSettings).toHaveBeenCalledWith({
			filterableAttributes: ['entityType', 'networkTime'],
			searchableAttributes: ['label', 'content'],
			sortableAttributes: ['label']
		});
		expect(waitTask).toHaveBeenCalledWith({ interval: 1, timeout: 1 });
	});
});

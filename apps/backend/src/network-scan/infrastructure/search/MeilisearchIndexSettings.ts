import type { Settings } from 'meilisearch';

export interface RequiredMeilisearchSettings {
	readonly filterableAttributes?: readonly string[];
	readonly searchableAttributes?: readonly string[];
	readonly sortableAttributes?: readonly string[];
}

interface MeilisearchTaskWaitOptions {
	readonly interval: number;
	readonly timeout: number;
}

interface MeilisearchSettingsTask {
	waitTask(options: MeilisearchTaskWaitOptions): Promise<{ status: string }>;
}

interface MeilisearchSettingsIndex {
	getSettings(): Promise<Settings>;
	updateSettings(settings: Settings): MeilisearchSettingsTask;
}

const stringList = (
	values: Settings['filterableAttributes']
): readonly string[] | null => {
	if (!Array.isArray(values)) return null;
	if (!values.every((value): value is string => typeof value === 'string')) {
		return null;
	}
	return values;
};

const sameStringSet = (
	actual: Settings['filterableAttributes'],
	expected: readonly string[] | undefined
): boolean => {
	if (expected === undefined) return true;
	const actualValues = stringList(actual);
	if (actualValues === null || actualValues.length !== expected.length) {
		return false;
	}

	const actualSet = new Set(actualValues);
	return expected.every((value) => actualSet.has(value));
};

export const meilisearchSettingsMatch = (
	settings: Settings,
	expected: RequiredMeilisearchSettings
): boolean =>
	sameStringSet(settings.filterableAttributes, expected.filterableAttributes) &&
	sameStringSet(settings.searchableAttributes, expected.searchableAttributes) &&
	sameStringSet(settings.sortableAttributes, expected.sortableAttributes);

const settingsPayload = (expected: RequiredMeilisearchSettings): Settings => ({
	filterableAttributes: expected.filterableAttributes
		? [...expected.filterableAttributes]
		: undefined,
	searchableAttributes: expected.searchableAttributes
		? [...expected.searchableAttributes]
		: undefined,
	sortableAttributes: expected.sortableAttributes
		? [...expected.sortableAttributes]
		: undefined
});

export const assertMeilisearchTaskSucceeded = (
	status: string,
	taskName: string
): void => {
	if (status !== 'succeeded')
		throw new Error(`Meilisearch ${taskName} task ended with ${status}`);
};

export const ensureMeilisearchSettings = async (
	index: MeilisearchSettingsIndex,
	expected: RequiredMeilisearchSettings,
	waitOptions: MeilisearchTaskWaitOptions,
	taskName = 'settings'
): Promise<void> => {
	const currentSettings = await index.getSettings().catch(() => null);
	if (
		currentSettings !== null &&
		meilisearchSettingsMatch(currentSettings, expected)
	) {
		return;
	}

	const settingsTask = await index
		.updateSettings(settingsPayload(expected))
		.waitTask(waitOptions);
	assertMeilisearchTaskSucceeded(settingsTask.status, taskName);
};

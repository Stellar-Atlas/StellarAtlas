import type { HistoryArchiveObject } from './HistoryArchiveObject.js';

export const historyArchiveStateRefreshAgeMs = 5 * 60 * 1000;

export function getHistoryArchiveStateRefreshBefore(
	now = new Date()
): Date {
	return new Date(now.getTime() - historyArchiveStateRefreshAgeMs);
}

export function getRefreshableHistoryArchiveStateArchiveIdentities(
	objects: readonly Pick<
		HistoryArchiveObject,
		'archiveUrlIdentity' | 'objectKey' | 'objectType'
	>[]
): readonly string[] {
	return [
		...new Set(
			objects
				.filter(
					(object) =>
						object.objectType === 'history-archive-state' &&
						object.objectKey === 'root'
				)
				.map((object) => object.archiveUrlIdentity)
		)
	];
}

import type {
	PublicFullHistoryLedgerCloseMetaStateStatus,
	PublicFullHistoryStateDataset
} from './types';
import {
	arrayOf,
	dateTime,
	isRecord,
	matches,
	nonNegativeInteger,
	nullable,
	oneOf,
	type StatusLiveValidator,
	unsignedIntegerString
} from './status-live-validator-primitives';

const stateDatasets = [
	'account-state-changes',
	'trustline-state-changes'
] as const satisfies readonly PublicFullHistoryStateDataset[];

const validateImportLifecycle = matches({
	complete: nonNegativeInteger,
	failed: nonNegativeInteger,
	importing: nonNegativeInteger,
	pending: nonNegativeInteger,
	total: nonNegativeInteger
});

const validateLinkageLifecycle = matches({
	checking: nonNegativeInteger,
	complete: nonNegativeInteger,
	failed: nonNegativeInteger,
	pending: nonNegativeInteger,
	total: nonNegativeInteger
});

const validateImportDataset = matches({
	dataset: oneOf(...stateDatasets),
	latestCompletedAt: nullable(dateTime),
	latestUpdatedAt: nullable(dateTime),
	lifecycle: validateImportLifecycle
});

const validateShape = matches({
	canonicalLinkage: matches({
		expectedLedgerCount: unsignedIntegerString,
		latestCompletedAt: nullable(dateTime),
		latestUpdatedAt: nullable(dateTime),
		lifecycle: validateLinkageLifecycle,
		matchedLedgerCount: unsignedIntegerString
	}),
	imports: matches({
		datasets: arrayOf(validateImportDataset, stateDatasets.length),
		latestCompletedAt: nullable(dateTime),
		latestUpdatedAt: nullable(dateTime),
		lifecycle: validateImportLifecycle
	})
});

export const validateFullHistoryLedgerCloseMetaStateStatus: StatusLiveValidator =
	(value: unknown): boolean => {
		if (!validateShape(value) || !isRecord(value)) return false;
		const imports = value.imports;
		const linkage = value.canonicalLinkage;
		if (!isRecord(imports) || !isRecord(linkage)) return false;
		if (!validateImportCollection(imports)) return false;
		if (!isRecord(linkage.lifecycle)) return false;
		if (!lifecycleTotalIsValid(linkage.lifecycle, 'checking')) return false;
		const expected = BigInt(String(linkage.expectedLedgerCount));
		const matched = BigInt(String(linkage.matchedLedgerCount));
		if (matched > expected) return false;
		const total = Number(linkage.lifecycle.total);
		const complete = Number(linkage.lifecycle.complete);
		if ((total === 0) !== (expected === 0n)) return false;
		return total === 0 || complete !== total || matched === expected;
	};

export function sanitizeFullHistoryLedgerCloseMetaStateStatus(
	value: unknown
): PublicFullHistoryLedgerCloseMetaStateStatus {
	if (
		!validateFullHistoryLedgerCloseMetaStateStatus(value) ||
		!isRecord(value)
	) {
		return createEmptyFullHistoryLedgerCloseMetaStateStatus();
	}
	const imports = asRecord(value.imports);
	const linkage = asRecord(value.canonicalLinkage);
	return {
		canonicalLinkage: {
			expectedLedgerCount: String(linkage.expectedLedgerCount),
			latestCompletedAt: nullableString(linkage.latestCompletedAt),
			latestUpdatedAt: nullableString(linkage.latestUpdatedAt),
			lifecycle: sanitizeLinkageLifecycle(linkage.lifecycle),
			matchedLedgerCount: String(linkage.matchedLedgerCount)
		},
		imports: {
			datasets: asArray(imports.datasets).map((dataset) => {
				const entry = asRecord(dataset);
				return {
					dataset: entry.dataset as PublicFullHistoryStateDataset,
					latestCompletedAt: nullableString(entry.latestCompletedAt),
					latestUpdatedAt: nullableString(entry.latestUpdatedAt),
					lifecycle: sanitizeImportLifecycle(entry.lifecycle)
				};
			}),
			latestCompletedAt: nullableString(imports.latestCompletedAt),
			latestUpdatedAt: nullableString(imports.latestUpdatedAt),
			lifecycle: sanitizeImportLifecycle(imports.lifecycle)
		}
	};
}

export function createEmptyFullHistoryLedgerCloseMetaStateStatus(): PublicFullHistoryLedgerCloseMetaStateStatus {
	return {
		canonicalLinkage: {
			expectedLedgerCount: '0',
			latestCompletedAt: null,
			latestUpdatedAt: null,
			lifecycle: emptyLinkageLifecycle(),
			matchedLedgerCount: '0'
		},
		imports: {
			datasets: stateDatasets.map((dataset) => ({
				dataset,
				latestCompletedAt: null,
				latestUpdatedAt: null,
				lifecycle: emptyImportLifecycle()
			})),
			latestCompletedAt: null,
			latestUpdatedAt: null,
			lifecycle: emptyImportLifecycle()
		}
	};
}

function validateImportCollection(imports: Record<string, unknown>): boolean {
	const datasets = imports.datasets;
	if (!Array.isArray(datasets)) return false;
	const observed = new Set<PublicFullHistoryStateDataset>();
	for (const value of datasets) {
		if (!isRecord(value) || !isRecord(value.lifecycle)) return false;
		if (!lifecycleTotalIsValid(value.lifecycle, 'importing')) return false;
		observed.add(value.dataset as PublicFullHistoryStateDataset);
	}
	if (
		datasets.length !== stateDatasets.length ||
		stateDatasets.some((dataset) => !observed.has(dataset))
	) {
		return false;
	}
	const aggregateLifecycle = imports.lifecycle;
	if (!isRecord(aggregateLifecycle)) return false;
	if (!lifecycleTotalIsValid(aggregateLifecycle, 'importing')) return false;
	return ['complete', 'failed', 'importing', 'pending', 'total'].every(
		(field) =>
			datasets.reduce<number>((total, value) => {
				const dataset = asRecord(value);
				const lifecycle = asRecord(dataset.lifecycle);
				return total + Number(lifecycle[field]);
			}, 0) === Number(aggregateLifecycle[field])
	);
}

function lifecycleTotalIsValid(
	lifecycle: Record<string, unknown>,
	activeKey: 'checking' | 'importing'
): boolean {
	return (
		Number(lifecycle.total) ===
		Number(lifecycle.pending) +
			Number(lifecycle[activeKey]) +
			Number(lifecycle.complete) +
			Number(lifecycle.failed)
	);
}

function sanitizeImportLifecycle(value: unknown) {
	const lifecycle = asRecord(value);
	return {
		complete: Number(lifecycle.complete),
		failed: Number(lifecycle.failed),
		importing: Number(lifecycle.importing),
		pending: Number(lifecycle.pending),
		total: Number(lifecycle.total)
	};
}

function sanitizeLinkageLifecycle(value: unknown) {
	const lifecycle = asRecord(value);
	return {
		checking: Number(lifecycle.checking),
		complete: Number(lifecycle.complete),
		failed: Number(lifecycle.failed),
		pending: Number(lifecycle.pending),
		total: Number(lifecycle.total)
	};
}

function emptyImportLifecycle() {
	return { complete: 0, failed: 0, importing: 0, pending: 0, total: 0 };
}

function emptyLinkageLifecycle() {
	return { checking: 0, complete: 0, failed: 0, pending: 0, total: 0 };
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function asArray(value: unknown): readonly unknown[] {
	return Array.isArray(value) ? value : [];
}

function nullableString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

import {
	buildEntityApiPath,
	parseEntityPage,
	requestExplorerJson,
	type AnalyticsEntityPage
} from './explorer-analytics';

export interface PairReportSelection {
	assetA: string;
	assetB: string;
	minLedger?: string;
	maxLedger?: string;
	limit: string;
}

export type PairReportLane = 'a-to-b' | 'b-to-a' | 'pool-a-b' | 'pool-b-a';

const assetPattern = /^[A-Za-z0-9]{1,12}:G[A-Z2-7]{55}$/;

function normalizeAsset(value: string, label: string): string {
	const asset = value.trim();
	if (/^(?:xlm|native)$/i.test(asset)) return 'native';
	if (!assetPattern.test(asset)) {
		throw new Error(`${label} must be XLM/native or a CODE:G... asset.`);
	}
	return asset;
}

function parseLedger(
	value: string | undefined,
	label: string
): number | undefined {
	if (value === undefined || value.trim() === '') return undefined;
	if (!/^\d+$/.test(value.trim())) {
		throw new Error(`${label} must be a safe integer ledger number.`);
	}
	const ledger = Number(value.trim());
	if (!Number.isSafeInteger(ledger) || ledger < 2) {
		throw new Error(`${label} must be a safe integer of at least 2.`);
	}
	return ledger;
}

export function validatePairReportSelection(
	selection: PairReportSelection
): PairReportSelection {
	const assetA = normalizeAsset(selection.assetA, 'Asset A');
	const assetB = normalizeAsset(selection.assetB, 'Asset B');
	if (assetA === assetB) throw new Error('Choose two distinct assets.');

	const minLedger = parseLedger(selection.minLedger, 'From ledger');
	const maxLedger = parseLedger(selection.maxLedger, 'To ledger');
	if ((minLedger === undefined) !== (maxLedger === undefined)) {
		throw new Error('Enter both ledger bounds or neither.');
	}
	if (minLedger !== undefined && maxLedger !== undefined) {
		if (maxLedger < minLedger) {
			throw new Error(
				'To ledger must be greater than or equal to From ledger.'
			);
		}
		if (maxLedger - minLedger > 2047) {
			throw new Error('Choose at most 2,048 ledgers per report.');
		}
	}

	const requestedLimit = selection.limit.trim();
	const limit = requestedLimit || '25';
	if (!['10', '25', '50', '100'].includes(limit)) {
		throw new Error('Limit must be 10, 25, 50, or 100.');
	}

	return {
		assetA,
		assetB,
		...(minLedger === undefined ? {} : { minLedger: String(minLedger) }),
		...(maxLedger === undefined ? {} : { maxLedger: String(maxLedger) }),
		limit
	};
}

export function pairReportApiPath(
	selection: PairReportSelection,
	lane: PairReportLane,
	offset = 0
): string {
	const selected = validatePairReportSelection(selection);
	if (!Number.isSafeInteger(offset) || offset < 0) {
		throw new Error('Offset must be a non-negative safe integer.');
	}

	const isPool = lane === 'pool-a-b' || lane === 'pool-b-a';
	const reverse = lane === 'b-to-a' || lane === 'pool-b-a';
	const filters: Record<string, string> = {
		...(selected.minLedger ? { min_ledger: selected.minLedger } : {}),
		...(selected.maxLedger ? { max_ledger: selected.maxLedger } : {}),
		limit: selected.limit
	};
	if (isPool) {
		filters.asset_a = reverse ? selected.assetB : selected.assetA;
		filters.asset_b = reverse ? selected.assetA : selected.assetB;
	} else {
		filters.selling_asset = reverse ? selected.assetB : selected.assetA;
		filters.buying_asset = reverse ? selected.assetA : selected.assetB;
	}
	return buildEntityApiPath(
		isPool ? 'liquidity-pools' : 'trades',
		undefined,
		filters,
		offset
	);
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		if (signal.reason !== undefined) throw signal.reason;
		throw new Error('The pair report request was aborted.');
	}
}

function parsePinnedPage(
	value: unknown,
	minLedger: number,
	maxLedger: number
): AnalyticsEntityPage {
	const page = parseEntityPage(value);
	if (
		page.window.minLedger !== minLedger ||
		page.window.maxLedger !== maxLedger
	) {
		throw new Error('The data service returned inconsistent ledger windows.');
	}
	return page;
}

export async function loadPairReport(
	selection: PairReportSelection,
	signal: AbortSignal,
	requestJson: typeof requestExplorerJson = requestExplorerJson,
	offsets: Partial<Readonly<Record<PairReportLane, number>>> = {}
): Promise<{
	selection: PairReportSelection;
	pages: Readonly<Record<PairReportLane, AnalyticsEntityPage>>;
}> {
	const selected = validatePairReportSelection(selection);
	throwIfAborted(signal);
	const first = parseEntityPage(
		await requestJson(
			pairReportApiPath(selected, 'a-to-b', offsets['a-to-b']),
			signal
		)
	);
	const pinnedSelection: PairReportSelection = {
		...selected,
		minLedger: String(first.window.minLedger),
		maxLedger: String(first.window.maxLedger)
	};
	const { minLedger, maxLedger } = first.window;

	throwIfAborted(signal);
	const [reverseTrades, forwardPools] = await Promise.all([
		requestJson(
			pairReportApiPath(pinnedSelection, 'b-to-a', offsets['b-to-a']),
			signal
		),
		requestJson(
			pairReportApiPath(pinnedSelection, 'pool-a-b', offsets['pool-a-b']),
			signal
		)
	]);
	const reversePage = parsePinnedPage(reverseTrades, minLedger, maxLedger);
	const forwardPoolPage = parsePinnedPage(forwardPools, minLedger, maxLedger);

	throwIfAborted(signal);
	const reversePools = await requestJson(
		pairReportApiPath(pinnedSelection, 'pool-b-a', offsets['pool-b-a']),
		signal
	);
	const reversePoolPage = parsePinnedPage(reversePools, minLedger, maxLedger);

	return {
		selection: pinnedSelection,
		pages: {
			'a-to-b': first,
			'b-to-a': reversePage,
			'pool-a-b': forwardPoolPage,
			'pool-b-a': reversePoolPage
		}
	};
}

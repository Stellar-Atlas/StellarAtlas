import {
	buildEntityApiPath,
	parseEntityPage,
	requestExplorerJson,
	type AnalyticsEntityPage
} from './explorer-analytics';
import { withExplorerReturnTo } from './explorer-return-context';

export interface PairReportSelection {
	assetA: string;
	assetB: string;
	minLedger?: string;
	maxLedger?: string;
	limit: string;
}

export type PairReportLane = 'a-to-b' | 'b-to-a' | 'pool-a-b' | 'pool-b-a';
export const pairReportLanes: readonly PairReportLane[] = ['a-to-b', 'b-to-a', 'pool-a-b', 'pool-b-a'];
export type PairReportSectionResult =
	| { readonly page: AnalyticsEntityPage; readonly error?: never }
	| { readonly page?: never; readonly error: string };

export function pairReportHref(
	selection: PairReportSelection,
	offsets: Partial<Readonly<Record<PairReportLane, number>>> = {},
	returnTo?: string | null
): string {
	const params = new URLSearchParams({
		asset_a: selection.assetA, asset_b: selection.assetB,
		min_ledger: selection.minLedger ?? '', max_ledger: selection.maxLedger ?? '', limit: selection.limit
	});
	for (const lane of pairReportLanes)
		if (offsets[lane]) params.set(lane + '_offset', String(offsets[lane]));
	return withExplorerReturnTo('/explorer/markets?' + params, returnTo, true);
}

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
	sections: Readonly<Record<PairReportLane, PairReportSectionResult>>;
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

	const load = async (lane: PairReportLane): Promise<PairReportSectionResult> => {
		throwIfAborted(signal);
		try {
			const raw = await requestJson(pairReportApiPath(pinnedSelection, lane, offsets[lane]), signal);
			throwIfAborted(signal);
			return { page: parsePinnedPage(raw, minLedger, maxLedger) };
		} catch (cause: unknown) {
			throwIfAborted(signal);
			return { error: cause instanceof Error ? cause.message : 'This section is unavailable.' };
		}
	};
	const [reverseTrades, forwardPools] = await Promise.all([load('b-to-a'), load('pool-a-b')]);
	const reversePools = await load('pool-b-a');

	return {
		selection: pinnedSelection,
		sections: {
			'a-to-b': { page: first },
			'b-to-a': reverseTrades,
			'pool-a-b': forwardPools,
			'pool-b-a': reversePools
		}
	};
}

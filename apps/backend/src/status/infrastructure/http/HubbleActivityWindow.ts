import type {
	HubbleTransferInput,
	HubbleTransferWatermark
} from './HubbleTransferContracts.js';
import {
	decodeTransferCursor,
	type HubbleTransferCursor
} from './HubbleTransferCursor.js';
import {
	defaultTransferLedgerSpan,
	validateTransferLedgerRange
} from './HubbleTransferValidation.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';

/** Shared published window policy for exact transfer and contract-event activity. */
export function resolveHubbleActivityWindow(
	input: HubbleTransferInput,
	maximumPublishedLedger: number,
	maximumRows: number,
	fingerprint: string
): {
	limit: number;
	minimumLedger: number;
	maximumLedger: number;
	watermark: HubbleTransferWatermark;
	cursor: HubbleTransferCursor | undefined;
} {
	const limit = input.limit!;
	if (limit > maximumRows)
		throw new HubbleWarehouseInputError(
			'Transfer limit exceeds the configured warehouse maximum'
		);

	const cursor =
		input.after === undefined
			? undefined
			: decodeTransferCursor(input.after, fingerprint);
	if (
		!Number.isSafeInteger(maximumPublishedLedger) ||
		maximumPublishedLedger < 0 ||
		maximumPublishedLedger > 2_147_483_647
	)
		throw new HubbleWarehouseUnavailableError(
			'Invalid transfer ingestion watermark'
		);
	const maximumLedger =
		cursor?.watermark.maximumLedger ??
		Math.min(input.maxLedger ?? maximumPublishedLedger, maximumPublishedLedger);
	const minimumLedger =
		cursor?.watermark.minimumLedger ??
		input.minLedger ??
		Math.max(1, maximumLedger - defaultTransferLedgerSpan + 1);
	if (input.minLedger !== undefined && input.maxLedger !== undefined)
		validateTransferLedgerRange(input.minLedger, input.maxLedger);
	if (maximumLedger > 0 && minimumLedger <= maximumLedger)
		validateTransferLedgerRange(minimumLedger, maximumLedger);
	if (
		cursor !== undefined &&
		(maximumLedger > maximumPublishedLedger ||
			maximumLedger > (input.maxLedger ?? maximumPublishedLedger) ||
			minimumLedger !==
				(input.minLedger ??
					Math.max(1, maximumLedger - defaultTransferLedgerSpan + 1)))
	)
		throw new HubbleWarehouseInputError(
			'Transfer cursor ledger window no longer matches the filters or published watermark'
		);
	const watermark: HubbleTransferWatermark = cursor?.watermark ?? {
		minimumLedger: maximumPublishedLedger === 0 ? 0 : minimumLedger,
		maximumLedger,
		observedAt: new Date().toISOString(),
		coverage: 'ingested-only'
	};

	return { limit, minimumLedger, maximumLedger, watermark, cursor };
}

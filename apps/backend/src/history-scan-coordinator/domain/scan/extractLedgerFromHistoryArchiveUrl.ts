const CATEGORY_LEDGER_PATTERN =
	/\/(?:history|ledger|transactions|results|scp)\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\/(?:history|ledger|transactions|results|scp)-([0-9a-f]{8})\.(?:json|xdr\.gz)$/i;

export function extractLedgerFromHistoryArchiveUrl(url: string): number | null {
	const match = CATEGORY_LEDGER_PATTERN.exec(url);
	if (!match) return null;

	return Number.parseInt(match[1], 16);
}

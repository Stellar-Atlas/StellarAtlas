import type { RequestHandler } from 'express';
import { readClaimableCursor, supportsClaimableCursorNetwork, type ClaimableCursorScope } from './ClaimablePositionCursor.js';
import { classicAddress, uint32 } from './HorizonAccountFields.js';
import { createExplorerAccountProvider, ExplorerAccountProviderError } from './ExplorerAccountProvider.js';
import { fetchExplorerClaimablePage, ClaimablePositionsUnsupportedError, type ClaimablePageQuery } from './ExplorerClaimablePage.js';
const maxPageSize = 25;
const pageKeyPattern = /^([1-9]\d{0,9})-(00000000[0-9a-f]{64})$/;
interface PositionKey { readonly ledger: number; readonly id: string }
const allowedQuery = ['role', 'limit', 'cursor'];

export function createExplorerClaimablePositionsHandler(config: {
	readonly horizonUrl: string;
	readonly networkPassphrase: string;
	readonly accountProvider?: ReturnType<typeof createExplorerAccountProvider>;
}): RequestHandler<{ accountId: string }> {
	const cursorNetworkSupported = supportsClaimableCursorNetwork(config.networkPassphrase);
	return async (req, res) => {
		res.setHeader('Cache-Control', 'no-store');
		const accountId = classicAddress(req.params.accountId);
		const { role, cursor } = req.query;
		const limit = readLimit(req.query.limit);
		if (
			!accountId ||
			(role !== 'claimant' && role !== 'sponsor') ||
			limit === null ||
			Object.keys(req.query).some((key) => !allowedQuery.includes(key))
		) {
			return res
				.status(400)
				.json({ error: 'invalid_claimable_positions_query' });
		}

		if (!cursorNetworkSupported)
			return res.status(502).json({ error: 'claimable_positions_unavailable' });
		const scope: ClaimableCursorScope = [config.networkPassphrase, accountId, role];
		const after = cursor === undefined ? null : parsePagingToken(readClaimableCursor(cursor, scope));
		if (cursor !== undefined && after === null)
			return res
				.status(400)
				.json({
					error: 'invalid_claimable_positions_cursor',
					message: 'Restart claimable-position pagination without a cursor.'
				});

		const controller = new AbortController();
		const abort = () => controller.abort();
		res.once('close', abort);
		try {
			const query: ClaimablePageQuery = { accountId, role, limit, after: after ? pagingToken(after) : null };
			const dto = config.accountProvider
				? await config.accountProvider.readClaimablePage(query, controller.signal)
				: await fetchExplorerClaimablePage(config.horizonUrl, query, { networkPassphrase: config.networkPassphrase, signal: controller.signal });
			return res.status(200).json(dto);
		} catch (error: unknown) {
			if (!controller.signal.aborted) {
				const attribution = config.accountProvider ? { provider: config.accountProvider.provider, transmission: 'operator_alternate' } : {};
				if (error instanceof ExplorerAccountProviderError) res.setHeader('Retry-After', String(error.retryAfterSeconds));
				const unsupported = error instanceof ClaimablePositionsUnsupportedError;
				return res.status(error instanceof ExplorerAccountProviderError ? error.status : unsupported ? 501 : 502)
					.json({ error: unsupported ? 'claimable_positions_unsupported' : 'claimable_positions_unavailable', ...attribution });
			}
		} finally {
			res.off('close', abort);
		}
	};
}

function parsePagingToken(value: unknown): PositionKey | null {
	if (typeof value !== 'string') return null;
	const match = pageKeyPattern.exec(value);
	if (!match?.[2]) return null;
	const ledger = uint32(Number(match[1]));
	return ledger === null ? null : { ledger, id: match[2] };
}

function pagingToken(key: PositionKey): string {
	return key.ledger + '-' + key.id;
}

function readLimit(value: unknown): number | null {
	if (value === undefined) return maxPageSize;
	if (typeof value !== 'string' || !/^[1-9]\d?$/.test(value)) return null;
	const limit = Number(value);
	return limit <= maxPageSize ? limit : null;
}

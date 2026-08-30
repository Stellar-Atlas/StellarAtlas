import express, { Router } from 'express';
import { StrKey } from '@stellar/stellar-sdk';

export interface HistoryAnalyticsRouterConfig {
	readonly fetcher?: typeof fetch;
	readonly horizonBaseUrl: string;
}

interface AssetIdentity {
	readonly canonical: string;
	readonly code: string | null;
	readonly issuer: string | null;
	readonly type: 'credit_alphanum4' | 'credit_alphanum12' | 'native';
}

interface HorizonBalance {
	readonly asset_code?: unknown;
	readonly asset_issuer?: unknown;
	readonly asset_type?: unknown;
	readonly balance?: unknown;
	readonly buying_liabilities?: unknown;
	readonly is_authorized?: unknown;
	readonly is_authorized_to_maintain_liabilities?: unknown;
	readonly is_clawback_enabled?: unknown;
	readonly limit?: unknown;
	readonly selling_liabilities?: unknown;
}

interface HorizonAccount {
	readonly account_id?: unknown;
	readonly balances?: unknown;
	readonly last_modified_ledger?: unknown;
	readonly paging_token?: unknown;
}

const defaultLimit = 50;
const maximumLimit = 200;
const assetCodePattern = /^[a-zA-Z0-9]{1,12}$/;

export function historyAnalyticsRouter(
	config: HistoryAnalyticsRouterConfig
): Router {
	const router = express.Router();
	const fetcher = config.fetcher ?? globalThis.fetch;
	const horizonRoot = withTrailingSlash(config.horizonBaseUrl);

	router.get('/assets/holders', async (req, res) => {
		const asset = parseAsset(req.query.asset);
		const cursor = parseCursor(req.query.cursor);
		const limit = parseLimit(req.query.limit);
		const order = parseOrder(req.query.order);
		if (
			asset === null ||
			cursor === false ||
			limit === null ||
			order === null
		) {
			return res.status(400).json({
				error:
					'asset must be native or CODE:ISSUER; cursor, order, or limit is invalid'
			});
		}

		if (asset.type === 'native') {
			return res.status(501).json({
				error:
					'Native XLM holder enumeration requires the local account-state index, which is not available yet'
			});
		}

		const accountsUrl = new URL('accounts', horizonRoot);
		accountsUrl.searchParams.set('limit', String(limit));
		accountsUrl.searchParams.set('order', order);
		accountsUrl.searchParams.set('asset', asset.canonical);
		if (cursor !== undefined) accountsUrl.searchParams.set('cursor', cursor);

		try {
			const [accountsResponse, rootResponse] = await Promise.all([
				fetcher(accountsUrl, {
					headers: { Accept: 'application/hal+json, application/json' }
				}),
				fetcher(horizonRoot, { headers: { Accept: 'application/json' } })
			]);
			if (!accountsResponse.ok || !rootResponse.ok) {
				return res
					.status(502)
					.json({ error: 'Owned Horizon current-state query failed' });
			}

			const accountsPayload: unknown = await accountsResponse.json();
			const rootPayload: unknown = await rootResponse.json();
			const accounts = horizonAccounts(accountsPayload);
			if (accounts === null) {
				return res
					.status(502)
					.json({ error: 'Owned Horizon returned an invalid account page' });
			}

			const records = accounts.flatMap((account) => {
				const mapped = mapHolder(account, asset);
				return mapped === null ? [] : [mapped];
			});
			const nextCursor =
				accounts.length === 0
					? null
					: (requireOptionalString(accounts.at(-1)?.paging_token) ?? null);
			const historyLatestLedger = horizonLatestLedger(rootPayload);

			return res
				.status(200)
				.setHeader('Cache-Control', 'public, max-age=5')
				.json({
					asset: {
						code: asset.code,
						id: asset.canonical,
						issuer: asset.issuer,
						type: asset.type
					},
					coverage: {
						historyLatestLedger,
						scope: 'current_state',
						source: 'owned_horizon'
					},
					generatedAt: new Date().toISOString(),
					limit,
					nextCursor,
					order,
					records
				});
		} catch {
			return res
				.status(502)
				.json({ error: 'Owned Horizon current-state query is unavailable' });
		}
	});

	return router;
}

function mapHolder(
	account: HorizonAccount,
	asset: AssetIdentity
): {
	readonly accountId: string;
	readonly balance: string;
	readonly buyingLiabilities: string;
	readonly isAuthorized: boolean | null;
	readonly isAuthorizedToMaintainLiabilities: boolean | null;
	readonly isClawbackEnabled: boolean | null;
	readonly lastModifiedLedger: string | null;
	readonly limit: string | null;
	readonly pagingToken: string;
	readonly sellingLiabilities: string;
} | null {
	const accountId = requireOptionalString(account.account_id);
	const pagingToken = requireOptionalString(account.paging_token);
	if (accountId === undefined || pagingToken === undefined) return null;
	if (!Array.isArray(account.balances)) return null;
	const balance = (account.balances as HorizonBalance[]).find((candidate) =>
		balanceMatchesAsset(candidate, asset)
	);
	const amount = requireOptionalString(balance?.balance);
	const buyingLiabilities = requireOptionalString(balance?.buying_liabilities);
	const sellingLiabilities = requireOptionalString(
		balance?.selling_liabilities
	);
	if (
		balance === undefined ||
		amount === undefined ||
		buyingLiabilities === undefined ||
		sellingLiabilities === undefined
	) {
		return null;
	}
	return {
		accountId,
		balance: amount,
		buyingLiabilities,
		isAuthorized: optionalBoolean(balance.is_authorized),
		isAuthorizedToMaintainLiabilities: optionalBoolean(
			balance.is_authorized_to_maintain_liabilities
		),
		isClawbackEnabled: optionalBoolean(balance.is_clawback_enabled),
		lastModifiedLedger:
			requireOptionalIntegerString(account.last_modified_ledger) ?? null,
		limit: requireOptionalString(balance.limit) ?? null,
		pagingToken,
		sellingLiabilities
	};
}

function balanceMatchesAsset(
	balance: HorizonBalance,
	asset: AssetIdentity
): boolean {
	if (asset.type === 'native') return balance.asset_type === 'native';
	return (
		balance.asset_code === asset.code && balance.asset_issuer === asset.issuer
	);
}

function parseAsset(value: unknown): AssetIdentity | null {
	if (value === 'native') {
		return {
			canonical: 'native',
			code: null,
			issuer: null,
			type: 'native'
		};
	}
	if (typeof value !== 'string') return null;
	const separator = value.indexOf(':');
	if (separator < 1 || separator !== value.lastIndexOf(':')) return null;
	const code = value.slice(0, separator);
	const issuer = value.slice(separator + 1);
	if (!assetCodePattern.test(code) || !StrKey.isValidEd25519PublicKey(issuer)) {
		return null;
	}
	return {
		canonical: code + ':' + issuer,
		code,
		issuer,
		type: code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12'
	};
}

function parseCursor(value: unknown): string | undefined | false {
	if (value === undefined) return undefined;
	return typeof value === 'string' && value.length >= 1 && value.length <= 256
		? value
		: false;
}

function parseLimit(value: unknown): number | null {
	if (value === undefined) return defaultLimit;
	if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed <= maximumLimit ? parsed : null;
}

function parseOrder(value: unknown): 'asc' | 'desc' | null {
	if (value === undefined || value === 'asc') return 'asc';
	return value === 'desc' ? 'desc' : null;
}

function horizonAccounts(payload: unknown): HorizonAccount[] | null {
	if (!isRecord(payload) || !isRecord(payload._embedded)) return null;
	const records = payload._embedded.records;
	return Array.isArray(records) ? (records as HorizonAccount[]) : null;
}

function horizonLatestLedger(payload: unknown): string | null {
	if (!isRecord(payload)) return null;
	return requireOptionalIntegerString(payload.history_latest_ledger) ?? null;
}

function requireOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requireOptionalIntegerString(value: unknown): string | undefined {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
		return String(value);
	}
	return typeof value === 'string' && /^[0-9]+$/.test(value)
		? value
		: undefined;
}

function optionalBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withTrailingSlash(value: string): string {
	return value.endsWith('/') ? value : value + '/';
}

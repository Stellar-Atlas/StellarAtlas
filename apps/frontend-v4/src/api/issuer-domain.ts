import { isClassicAccount } from '../domain/classic-account';
import { recordValue } from './explorer-analytics';

export const ISSUER_DOMAIN_MAX_INPUT = 254;
export const ISSUER_DOMAIN_PATH = '/explorer/issuers/by-domain';

export function normalizeIssuerDomain(value: string): string | null {
	const input = value.trim();
	if (input.length > ISSUER_DOMAIN_MAX_INPUT || !/^[a-z0-9.-]+$/i.test(input)) return null;
	const host = input.toLowerCase().replace(/\.$/, '');
	const labels = host.split('.');
	const last = labels.at(-1) ?? '';
	if (host.length > 253 || labels.length < 2 || last === 'xlm' || !/[a-z]/.test(last) ||
		labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
	try {
		return new URL('https://' + host).hostname === host ? host : null;
	} catch {
		return null;
	}
}

export function issuerDomainHref(domain: string): string {
	return ISSUER_DOMAIN_PATH + '?' + new URLSearchParams({ domain });
}

const coverage = ['available', 'partial', 'unavailable'] as const;
const associations = ['corroborated', 'mismatch', 'indexed_only', 'toml_only', 'unavailable'] as const;
const homeStatuses = ['observed', 'stale', 'unavailable'] as const;
const tomlStatuses = ['available', 'stale', 'unavailable'] as const;
const assetTomlStatuses = ['listed', 'not_listed', 'unavailable'] as const;
const claimTypes = ['ACCOUNTS', 'CURRENCIES'] as const;

function invalid(): never { throw new Error('Invalid issuer-domain response'); }

function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
	return allowed.find(item => item === value) ?? invalid();
}

function rows(value: unknown, max: number): unknown[] {
	if (!Array.isArray(value) || value.length > max) invalid();
	return value;
}

function flag(value: unknown): boolean {
	return typeof value === 'boolean' ? value : invalid();
}

function timestamp(value: unknown): string | null {
	if (value === null) return null;
	return typeof value === 'string' && value.length <= 40 &&
		/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
		? value : invalid();
}

function parseAsset(value: unknown, account: string) {
	const row = recordValue(value);
	const { code, id } = row;
	if (typeof code !== 'string' || !/^[A-Za-z0-9]{1,12}$/.test(code) || id !== code + ':' + account)
		invalid();
	const ledger = row.catalogue === null ? null : recordValue(row.catalogue).lastObservedLedger;
	if (ledger !== null && (typeof ledger !== 'number' || !Number.isSafeInteger(ledger) || ledger < 1 || ledger > 4294967295))
		invalid();
	return { id, code, ledger, toml: choice(row.toml, assetTomlStatuses) };
}

function parseAccount(value: unknown) {
	const row = recordValue(value);
	const { accountId } = row;
	if (typeof accountId !== 'string' || !isClassicAccount(accountId)) invalid();
	const observation = recordValue(row.homeDomain);
	const domain = observation.domain;
	if (row.homeDomain !== null && (observation.source !== 'indexed_account_home_domain' ||
		(domain !== null && (typeof domain !== 'string' || normalizeIssuerDomain(domain) !== domain)))) invalid();
	const assets = rows(row.assets, 20).map(asset => parseAsset(asset, accountId));
	if (new Set(assets.map(asset => asset.id)).size !== assets.length) invalid();
	return {
		accountId,
		association: choice(row.association, associations),
		homeDomain: row.homeDomain === null ? null : {
			domain: typeof domain === 'string' ? domain : null,
			observedAt: timestamp(observation.observedAt),
			status: choice(observation.status, homeStatuses)
		},
		tomlClaims: rows(row.tomlClaims, 2).map(claim => choice(claim, claimTypes)),
		assets,
		assetsTruncated: flag(row.assetsTruncated)
	};
}

export function parseIssuerDomain(value: unknown, domain: string) {
	const data = recordValue(value);
	if (data.domain !== domain || data.source !== 'cached_issuer_domain_evidence' ||
		typeof data.networkPassphrase !== 'string') invalid();
	const catalogue = recordValue(data.catalogue);
	const toml = recordValue(data.toml);
	const accounts = rows(data.accounts, 25).map(parseAccount);
	if (new Set(accounts.map(account => account.accountId)).size !== accounts.length) invalid();
	return {
		domain,
		homeDomainIndex: choice(data.homeDomainIndex, coverage),
		catalogue: { status: choice(catalogue.status, coverage), generatedAt: timestamp(catalogue.generatedAt) },
		toml: { status: choice(toml.status, tomlStatuses), fetchedAt: timestamp(toml.fetchedAt), accountsIndexed: flag(toml.accountsIndexed) },
		accounts,
		accountsTruncated: flag(data.accountsTruncated)
	};
}

export type IssuerDomainEvidence = ReturnType<typeof parseIssuerDomain>;
export type IssuerDomainOutcome =
	| { kind: 'ready'; evidence: IssuerDomainEvidence }
	| { kind: 'unavailable' }
	| { kind: 'error' };

export async function requestIssuerDomain(domain: string, signal: AbortSignal): Promise<IssuerDomainOutcome> {
	try {
		const response = await fetch('/v1/issuer-domains/' + encodeURIComponent(domain), {
			signal, credentials: 'omit', headers: { accept: 'application/json' }
		});
		if (response.status === 503) return { kind: 'unavailable' };
		if (!response.ok) return { kind: 'error' };
		return { kind: 'ready', evidence: parseIssuerDomain(await response.json(), domain) };
	} catch {
		return { kind: 'error' };
	}
}

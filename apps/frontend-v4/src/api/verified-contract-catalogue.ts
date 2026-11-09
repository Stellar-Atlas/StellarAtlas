import { isContractAccount } from '../domain/classic-account';
import { publicNetworkPassphrase } from './explorer-current-account-snapshot';
import { ApiClientError, fetchValidatedJson } from './http-client';

export const verifiedContractsPath = '/explorer/verified-contracts';
export const contractVerificationGuidePath = '/docs/contract-verification';
const cataloguePath = '/v1/contracts/catalogue';
const defaultLimit = 25;
const maxLimit = 50;
export const catalogueQueryLimit = 140;
const repoOwner = '[a-z0-9][a-z0-9-]{0,38}';
const repositoryPrefix = new RegExp('^' + repoOwner + '(?:/[a-z0-9._-]{0,100})?$', 'i');
const repositoryName = new RegExp('^' + repoOwner + '/[a-z0-9._-]{1,100}$', 'i');
const cursorPattern = /^[a-zA-Z0-9_-]{1,512}$/;
const sha256 = /^[a-f0-9]{64}$/;
const gitCommit = /^[a-f0-9]{40}$/;

export type CatalogueQuery = {
	readonly q: string;
	readonly limit: number;
	readonly cursor: string | null;
};
export type CatalogueSearchParams = Readonly<Record<string, string | string[] | undefined>>;
export type ContractCatalogueItem = {
	readonly contractId: string;
	readonly observedLedger: number;
	readonly instanceModifiedLedger: number | null;
	readonly checkedAt: string;
	readonly wasmSha256: string;
	readonly source: { readonly repository: string; readonly commit: string; readonly url: string };
};
export type ContractCatalogue = {
	readonly networkPassphrase: string;
	readonly items: readonly ContractCatalogueItem[];
	readonly nextCursor: string | null;
};
export type CatalogueResult =
	| { readonly kind: 'ready'; readonly catalogue: ContractCatalogue }
	| { readonly kind: 'unavailable' | 'query_rejected' };

export function parseCatalogueQuery(params: CatalogueSearchParams): CatalogueQuery | null {
	const { q = '', limit = String(defaultLimit), cursor } = params;
	if (typeof q !== 'string' || q.length > catalogueQueryLimit ||
		typeof limit !== 'string' || !/^[1-9][0-9]?$/.test(limit) || Number(limit) > maxLimit ||
		(cursor !== undefined && (typeof cursor !== 'string' || !cursorPattern.test(cursor)))) return null;
	const term = q.trim();
	const exact = isContractAccount(term.toUpperCase());
	if (term && !exact && !repositoryPrefix.test(term)) return null;
	return { q: exact ? term.toUpperCase() : term.toLowerCase(), limit: Number(limit), cursor: cursor ?? null };
}

function catalogueHref(path: string, query: CatalogueQuery): string {
	const params = new URLSearchParams();
	if (query.q) params.set('q', query.q);
	if (query.limit !== defaultLimit) params.set('limit', String(query.limit));
	if (query.cursor) params.set('cursor', query.cursor);
	return params.size ? path + '?' + params : path;
}

export function verifiedContractsHref(query: CatalogueQuery): string {
	return catalogueHref(verifiedContractsPath, query);
}

export function contractCatalogueNetwork(passphrase: string): string {
	switch (passphrase) {
		case publicNetworkPassphrase: return 'Stellar Mainnet';
		case 'Test SDF Network ; September 2015': return 'Stellar Testnet';
		case 'Test SDF Future Network ; October 2022': return 'Stellar Futurenet';
		default: return passphrase;
	}
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isLedger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xffffffff;
}

function parseCatalogueItem(value: unknown): ContractCatalogueItem | null {
	const row = record(value);
	if (!row) return null;
	const { contractId, observedLedger, instanceModifiedLedger, checkedAt, wasmSha256 } = row;
	if (typeof contractId !== 'string' || !isContractAccount(contractId) ||
		!isLedger(observedLedger) ||
		(instanceModifiedLedger !== null && (!isLedger(instanceModifiedLedger) || instanceModifiedLedger > observedLedger)) ||
		typeof checkedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(checkedAt) ||
		!Number.isFinite(Date.parse(checkedAt)) ||
		typeof wasmSha256 !== 'string' || !sha256.test(wasmSha256) ||
		row.ledgerEvidence !== 'configured_rpc_observation' ||
		row.independentReproduction !== 'not_assessed' || row.securityAudit !== 'not_assessed') return null;
	const build = record(row.build);
	const source = record(build?.record);
	if (build?.status !== 'verified' || !source) return null;
	const { repository, commit, sourceUrl } = source;
	if (typeof repository !== 'string' || !repositoryName.test(repository) || /\/\.{1,2}$/.test(repository) ||
		typeof commit !== 'string' || !gitCommit.test(commit)) return null;
	// The verified record binds this exact repository and commit, not an arbitrary URL.
	const url = 'https://github.com/' + repository + '/tree/' + commit;
	if (typeof sourceUrl !== 'string' || sourceUrl.toLowerCase() !== url.toLowerCase()) return null;
	return { contractId, observedLedger, instanceModifiedLedger, checkedAt, wasmSha256, source: { repository, commit, url } };
}

export function parseContractCatalogue(value: unknown, query: CatalogueQuery): ContractCatalogue | null {
	const data = record(value);
	if (!data || data.version !== 1) return null;
	const { networkPassphrase, nextCursor } = data;
	const source: unknown = data.items;
	if (typeof networkPassphrase !== 'string' || !networkPassphrase.trim() ||
		networkPassphrase.length > 128 || /[\u0000-\u001f\u007f]/.test(networkPassphrase) ||
		!Array.isArray(source) || source.length > query.limit ||
		(nextCursor !== null && (typeof nextCursor !== 'string' || !cursorPattern.test(nextCursor) ||
			nextCursor === query.cursor || source.length === 0))) return null;
	const items: ContractCatalogueItem[] = [];
	const ids = new Set<string>();
	const exact = isContractAccount(query.q);
	for (const value of source) {
		const row = parseCatalogueItem(value);
		if (!row || ids.has(row.contractId) || (query.q && (exact
			? row.contractId !== query.q : !row.source.repository.toLowerCase().startsWith(query.q)))) return null;
		ids.add(row.contractId);
		items.push(row);
	}
	return { networkPassphrase, nextCursor, items };
}

export async function loadContractCatalogue(query: CatalogueQuery): Promise<CatalogueResult> {
	try {
		const catalogue = await fetchValidatedJson(
			catalogueHref(cataloguePath, query),
			(value) => parseContractCatalogue(value, query),
			{ cache: 'no-store' }
		);
		return { kind: 'ready', catalogue };
	} catch (error) {
		return { kind: error instanceof ApiClientError && error.statusCode === 400 ? 'query_rejected' : 'unavailable' };
	}
}

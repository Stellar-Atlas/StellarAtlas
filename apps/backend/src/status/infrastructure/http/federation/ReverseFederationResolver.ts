import { Networks, StrKey } from '@stellar/stellar-sdk';
import * as toml from 'toml';
import {
	issuerTomlUrl,
	isRecord
} from '../asset-metadata/AssetMetadataValues.js';
import { requestPublicHttps } from '../asset-metadata/safeHttp.js';
import { normalizeIssuerDomain } from '../issuer-domains/IssuerDomainCache.js';
import {
	FederationThrottled,
	type FederationProviderBudget
} from './FederationProviderBudget.js';

const maxPending = 8;
const discoveryBytes = 100_000;
const federationBytes = 4096;
const deadlineMs = 8000;
const decoder = new TextDecoder('utf-8', { fatal: true });

type FailureStatus =
	'unsupported' | 'not_found' | 'mismatch' | 'malformed' | 'temporary_failure';

export type ReverseFederationResult =
	| { readonly status: FailureStatus }
	| { readonly status: 'throttled'; readonly retryAtMs: number }
	| {
			readonly status: 'display_only';
			readonly accountId: string;
			readonly stellarAddress: string;
			readonly memo: {
				readonly type: 'text' | 'id' | 'hash';
				readonly value: string;
			} | null;
			readonly homeDomain: string;
			readonly reverseProviderOrigin: string;
			readonly aliasDomain: string;
			readonly forwardProviderOrigin: string;
	  };

class LookupFailure extends Error {
	constructor(readonly status: FailureStatus) {
		super(status);
	}
}

interface FederationRecord {
	accountId: string;
	stellarAddress: string;
	domain: string;
	memo: Extract<ReverseFederationResult, { status: 'display_only' }>['memo'];
}

/**
 * The outbound owner runs on demand and retains only unresolved promises.
 * Serve results with Cache-Control: no-store and discard them with the current
 * view. Payment clients need a fresh resolution of the intended name.
 */
export class ReverseFederationResolver {
	private readonly pending = new Map<
		string,
		Promise<ReverseFederationResult>
	>();

	constructor(
		private readonly budget: FederationProviderBudget,
		private readonly request: typeof requestPublicHttps = requestPublicHttps,
		private readonly networkPassphrase?: string
	) {}

	resolve(
		accountId: string,
		observedHomeDomain: string | null
	): Promise<ReverseFederationResult> {
		const homeDomain =
			typeof observedHomeDomain === 'string' && observedHomeDomain.length <= 254
				? normalizeIssuerDomain(observedHomeDomain)
				: null;
		if (
			!homeDomain ||
			accountId.length !== 56 ||
			!StrKey.isValidEd25519PublicKey(accountId)
		)
			return Promise.resolve({ status: 'unsupported' });
		const key = homeDomain + '/' + accountId;
		const active = this.pending.get(key);
		if (active) return active;
		if (this.pending.size >= maxPending)
			return Promise.resolve({ status: 'temporary_failure' });
		const lookup = this.lookup(
			accountId,
			homeDomain,
			AbortSignal.timeout(deadlineMs)
		).finally(() => this.pending.delete(key));
		this.pending.set(key, lookup);
		return lookup;
	}

	private async lookup(
		accountId: string,
		homeDomain: string,
		signal: AbortSignal
	): Promise<ReverseFederationResult> {
		try {
			const reverseEndpoint = await this.discover(homeDomain, signal);
			const reverse = await this.query(
				reverseEndpoint,
				accountId,
				'id',
				signal
			);
			if (reverse.accountId !== accountId) return { status: 'mismatch' };
			const forwardEndpoint =
				reverse.domain === homeDomain
					? reverseEndpoint
					: await this.discover(reverse.domain, signal);
			const forward = await this.query(
				forwardEndpoint,
				reverse.stellarAddress,
				'name',
				signal
			);
			if (
				forward.accountId !== accountId ||
				forward.stellarAddress !== reverse.stellarAddress ||
				forward.memo?.type !== reverse.memo?.type ||
				forward.memo?.value !== reverse.memo?.value
			)
				return { status: 'mismatch' };
			return {
				status: 'display_only',
				accountId,
				stellarAddress: reverse.stellarAddress,
				memo: reverse.memo,
				homeDomain,
				reverseProviderOrigin: new URL(reverseEndpoint).origin,
				aliasDomain: reverse.domain,
				forwardProviderOrigin: new URL(forwardEndpoint).origin
			};
		} catch (error) {
			if (error instanceof FederationThrottled)
				return { status: 'throttled', retryAtMs: error.retryAtMs };
			return {
				status:
					error instanceof LookupFailure ? error.status : 'temporary_failure'
			};
		}
	}

	private async discover(domain: string, signal: AbortSignal): Promise<string> {
		const response = await this.get(
			issuerTomlUrl(domain),
			'text/plain',
			discoveryBytes,
			signal
		);
		if (response.status === 404) throw new LookupFailure('unsupported');
		if (response.status !== 200) throw new LookupFailure('temporary_failure');
		let document: unknown;
		try {
			document = toml.parse(decoder.decode(response.body));
		} catch {
			throw new LookupFailure('malformed');
		}
		if (!isRecord(document)) throw new LookupFailure('malformed');
		if (
			this.networkPassphrase &&
			(document.NETWORK_PASSPHRASE ?? Networks.PUBLIC) !==
				this.networkPassphrase
		)
			throw new LookupFailure('unsupported');
		const endpoint = document.FEDERATION_SERVER;
		if (endpoint === undefined) throw new LookupFailure('unsupported');
		return checkedEndpoint(endpoint);
	}

	private async query(
		endpoint: string,
		value: string,
		type: 'id' | 'name',
		signal: AbortSignal
	): Promise<FederationRecord> {
		const separator =
			endpoint.endsWith('?') || endpoint.endsWith('&')
				? ''
				: endpoint.includes('?')
					? '&'
					: '?';
		const response = await this.get(
			endpoint + separator + 'q=' + encodeURIComponent(value) + '&type=' + type,
			'application/json',
			federationBytes,
			signal
		);
		if (response.status === 404)
			throw new LookupFailure(type === 'id' ? 'not_found' : 'mismatch');
		if (response.status !== 200) throw new LookupFailure('temporary_failure');
		try {
			return parseRecord(JSON.parse(decoder.decode(response.body)));
		} catch {
			throw new LookupFailure('malformed');
		}
	}

	private async get(
		url: string,
		accept: string,
		limit: number,
		signal: AbortSignal
	) {
		const provider = normalizeIssuerDomain(new URL(url).hostname);
		if (!provider) throw new LookupFailure('malformed');
		const response = await this.budget.run(
			provider,
			async () => {
				signal.throwIfAborted();
				const result = await this.request(
					url,
					{ accept, 'cache-control': 'no-store' },
					limit,
					{
						signal,
						followRedirects: false
					}
				);
				if (result.body.byteLength > limit)
					throw new LookupFailure('malformed');
				return result;
			},
			signal
		);
		return response;
	}
}

function checkedEndpoint(value: unknown): string {
	if (
		typeof value !== 'string' ||
		value.length > 1024 ||
		!/^https:\/\/[a-z0-9.-]+(?::443)?(?:[/?]|$)/i.test(value) ||
		/[\\#\s\p{Cc}]/u.test(value)
	)
		throw new LookupFailure('malformed');
	let endpoint: URL;
	try {
		endpoint = new URL(value);
	} catch {
		throw new LookupFailure('malformed');
	}
	if (
		endpoint.username ||
		endpoint.password ||
		endpoint.port ||
		!normalizeIssuerDomain(endpoint.hostname) ||
		[...endpoint.searchParams.keys()].some((name) => /^(q|type)$/i.test(name))
	)
		throw new LookupFailure('malformed');
	return value;
}

function parseRecord(value: unknown): FederationRecord {
	if (!isRecord(value)) throw new LookupFailure('malformed');
	const { stellar_address, account_id, memo_type, memo } = value;
	if (
		typeof stellar_address !== 'string' ||
		stellar_address.length > 512 ||
		typeof account_id !== 'string' ||
		account_id.length !== 56 ||
		!StrKey.isValidEd25519PublicKey(account_id)
	)
		throw new LookupFailure('malformed');
	const parts = stellar_address.split('*');
	const [username, rawDomain] = parts;
	if (
		parts.length !== 2 ||
		!username ||
		!rawDomain ||
		/[<>\s\p{C}]/u.test(username) ||
		/\s/u.test(rawDomain)
	)
		throw new LookupFailure('malformed');
	const domain = normalizeIssuerDomain(rawDomain);
	if (!domain) throw new LookupFailure('malformed');
	return {
		accountId: account_id,
		stellarAddress: stellar_address,
		domain,
		memo: parseMemo(memo_type, memo)
	};
}

function parseMemo(type: unknown, value: unknown): FederationRecord['memo'] {
	if (type === undefined && value === undefined) return null;
	if (typeof value !== 'string') throw new LookupFailure('malformed');
	if (
		type === 'text' &&
		Buffer.byteLength(value) <= 28 &&
		!/[\p{Cc}\p{Cs}]/u.test(value)
	)
		return { type, value };
	if (
		type === 'id' &&
		/^[0-9]{1,20}$/.test(value) &&
		BigInt(value) <= 0xffffffffffffffffn
	)
		return { type, value };
	if (
		type === 'hash' &&
		/^[A-Za-z0-9+/]{43}=$/.test(value) &&
		Buffer.from(value, 'base64').toString('base64') === value
	)
		return { type, value };
	throw new LookupFailure('malformed');
}

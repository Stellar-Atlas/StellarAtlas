import type { SafeResponse } from './safeHttp.js';
export type AssetMetadataStatus = 'pending' | 'ready' | 'unavailable';

export interface AssetMetadataInput {
	readonly id: string;
	readonly code?: string;
	readonly issuer?: string;
	readonly contractId?: string;
}

export interface AssetMetadata {
	readonly id: string;
	readonly status: AssetMetadataStatus;
	readonly name: string | null;
	readonly description: string | null;
	readonly homeDomain: string | null;
	readonly tomlUrl: string | null;
	readonly logoStatus?: 'pending' | 'ready' | 'unavailable' | null;
	readonly logoUrl: string | null;
	/** Unverified scalar claims copied from the exact issuer-provided CURRENCIES entry. */
	readonly fields?: Readonly<Record<string, string>>;
	readonly organization: Readonly<Record<string, string>>;
	readonly fetchedAt: string | null;
	readonly error: string | null;
}

export interface IssuerMetadata {
	readonly homeDomain: string;
	readonly tomlUrl: string;
	readonly networkPassphrase: string;
	readonly currencies: readonly CurrencyEntry[];
	readonly fields: Readonly<Record<string, string>>;
	readonly fetchedAt: string;
	readonly etag: string | null;
	readonly lastModified: string | null;
	readonly error: string | null;
	readonly lastAttemptAt: string | null;
}

export interface CurrencyEntry {
	readonly code: string | null;
	readonly issuer: string | null;
	readonly contract: string | null;
	readonly name: string | null;
	readonly description: string | null;
	readonly image: string | null;
	readonly fields: Readonly<Record<string, string>>;
}

export interface AssetMetadataServiceOptions {
	readonly resolveIssuerHomeDomain: (issuer: string) => Promise<string | null>;
	readonly networkPassphrase: string;
	readonly cacheRoot: string;
	readonly requestImpl?: (
		url: string,
		headers: Readonly<Record<string, string>>,
		maxBytes: number
	) => Promise<SafeResponse>;
	readonly now?: () => number;
}

export type Asset = {
	id: string;
	kind: 'native' | 'classic' | 'contract';
	code?: string;
	issuer?: string;
	contractId?: string;
	observed?: boolean;
	name?: string;
	logoUrl?: string;
	firstObservedLedger?: number;
	lastObservedLedger?: number;
	firstObservedAt?: string;
	lastObservedAt?: string;
};
export type Organization = string | Readonly<Record<string, string>>;
export type Metadata = {
	status?: string;
	name?: string;
	description?: string;
	homeDomain?: string;
	tomlUrl?: string;
	logoUrl?: string;
	organization?: Organization;
	fields?: Readonly<Record<string, string>>;
	fetchedAt?: string;
	error?: string;
};
export type AssetPage = { data: Asset[]; nextCursor: string | null };
export type AssetRecord = { asset: Asset; metadata?: Metadata };

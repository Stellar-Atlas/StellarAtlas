export type BalanceAssetType = 'native' | 'credit_alphanum4' | 'credit_alphanum12';
export interface BalanceFlagEvidence {
	readonly assetType?: BalanceAssetType;
	readonly flags?: number;
	readonly flagStatus?: 'recorded' | 'missing' | 'invalid';
}

/** Preserve only typed UInt32 evidence; never coerce strings or default to zero. */
export function parseBalanceFlagEvidence(asset: string, assetType: unknown, flags: unknown): BalanceFlagEvidence {
	const type = (assetType === 'native' || assetType === 'credit_alphanum4' || assetType === 'credit_alphanum12') && ((asset === 'native') === (assetType === 'native')) ? assetType : undefined;
	const value = typeof flags === 'number' && Number.isInteger(flags) && !Object.is(flags, -0) && flags >= 0 && flags <= 4294967295 ? flags : undefined;
	return {
		...(type === undefined ? {} : {assetType: type}),
		...(value === undefined ? {} : {flags: value}),
		flagStatus: (assetType !== undefined && type === undefined) || (flags !== undefined && value === undefined) ? 'invalid' : assetType === undefined || flags === undefined ? 'missing' : 'recorded'
	};
}

export interface BalanceFlagDescription {
	readonly label: string;
	readonly context: string;
	readonly known: readonly string[];
	readonly unknownBits: number;
	readonly clawback: boolean;
}
// AccountFlags and TrustLineFlags are separate XDR enums, not one shared mask.
// https://github.com/stellar/stellar-xdr/blob/master/Stellar-ledger-entries.x
export function describeBalanceFlags(evidence: BalanceFlagEvidence): BalanceFlagDescription {
	const account = evidence.assetType === 'native';
	const context = evidence.assetType === undefined ? 'Flag type was not recorded or could not be validated.' : account ? 'Issuer policy on this account, not XLM transfer authorization.' : 'Trustline flags at the observation ledger, not current spendability.';
	const unknown = {context, known: [], unknownBits: 0, clawback: false};
	if (evidence.flagStatus !== 'recorded' || evidence.flags === undefined || evidence.assetType === undefined) return {
		...unknown,
		label: evidence.flagStatus === 'invalid' ? 'Flag details unavailable' : 'Flag details not recorded'
	};
	const flags = evidence.flags;
	const bits = account ? [
		[1, 'Issuer authorization required'], [2, 'Issuer authorization revocable'],
		[4, 'Issuer authorization immutable'], [8, 'Issuer clawback enabled']
	] as const : [[1, 'Authorized'], [2, 'Maintain liabilities'], [4, 'Clawback enabled']] as const;
	const unknownBits = flags - (flags & (account ? 15 : 7));
	const auth = flags & 3;
	return {
		context,
		known: bits.filter(([bit]) => (flags & bit) !== 0).map(([, label]) => label),
		unknownBits,
		clawback: !account && (flags & 4) !== 0,
		label: account ? unknownBits ? 'Account policy unknown' : 'Account policy · observed' : unknownBits || auth === 3 ? 'Authorization unknown' : auth === 1 ? 'Authorized · observed' : auth === 2 ? 'Liabilities only · observed' : 'Not authorized · observed'
	};
}

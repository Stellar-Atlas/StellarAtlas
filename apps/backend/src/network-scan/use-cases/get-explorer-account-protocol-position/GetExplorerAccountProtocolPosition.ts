import { Asset, Networks, StrKey } from '@stellar/stellar-sdk';
import type { FullHistoryCanonicalRepository } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import { fullHistoryLedgerSequence } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { blendFixedSupplyTarget } from '../../../status/infrastructure/soroban-positions/BlendFixedSupply.js';
import type { createBlendRetainedSupply } from '../../../status/infrastructure/soroban-positions/BlendRetainedSupply.js';
import type { PositionSnapshot } from '../../../status/infrastructure/soroban-positions/TimelockPositions.js';

const { networkId, poolId, wasmSha256 } = blendFixedSupplyTarget;
const assetContractId = Asset.native().contractId(Networks.PUBLIC);
const coverage = 'blend_fixed_v2_1_native_xlm_supply_only';
const digestPattern = /^[a-f0-9]{64}$/;
const target = Object.freeze({
	poolId,
	assetId: 'native',
	assetContractId,
	reserveIndex: 0
} as const);

export interface PublicEligibleObservation {
	readonly state: 'completed';
	readonly display: 'public_derived';
	readonly accountId: string;
	readonly poolId: string;
	readonly assetId: 'native';
	readonly reserveIndex: 0;
	readonly wasmSha256: string;
	readonly snapshot: PositionSnapshot;
	readonly ledgerClosedAt: Date;
	readonly accountSha256: string;
}

interface AsOf {
	readonly ledger: number;
	readonly ledgerHash: string;
	readonly closedAt: string;
	readonly ageSeconds: number;
	readonly freshness: 'recent' | 'historical';
}

type RetainedReader = Pick<
	ReturnType<typeof createBlendRetainedSupply>,
	'read'
>;
type RetainedPosition = Extract<
	Awaited<ReturnType<RetainedReader['read']>>,
	{ status: 'retained' }
>['position'];

function derivedPosition(
	position: Extract<RetainedPosition, { status: 'observed' }>
) {
	const estimate = position.underlyingEstimate;
	return {
		supplySharesRaw: position.supplySharesRaw,
		supplyShareDecimals: position.supplyShareDecimals,
		underlyingEstimate: {
			kind: estimate.kind,
			amountRaw: estimate.amountRaw,
			decimals: estimate.decimals,
			rateRaw: estimate.rateRaw,
			rateDecimals: estimate.rateDecimals,
			rateUpdatedAtEpochSeconds: estimate.rateUpdatedAtEpochSeconds
		},
		balanceScope: position.balanceScope,
		withdrawal: position.withdrawal
	};
}

type Result = {
	readonly network: 'mainnet';
	readonly accountId: string;
	readonly target: typeof target;
	readonly coverage: typeof coverage;
	readonly includedInCurrentTotals: false;
} & (
	| { readonly status: 'unavailable'; readonly asOf: null }
	| { readonly status: 'unobserved'; readonly asOf: AsOf }
	| {
			readonly status: 'observed';
			readonly asOf: AsOf;
			readonly position: ReturnType<typeof derivedPosition>;
	  }
);

export function isProtocolPositionAccount(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length === 56 &&
		StrKey.isValidEd25519PublicKey(value)
	);
}

/**
 * Passive reader for the fixed reviewed Blend target. The lookup is a
 * server-owned eligibility boundary, and returns at most one completed
 * observation selected for public derived display. The caller supplies an
 * account only. Recent means within the injected age policy, not a current
 * balance or withdrawal quote.
 */
export function createGetExplorerAccountProtocolPosition({
	lookup,
	canonicalLedger,
	retained,
	recentWithinMs,
	now = Date.now
}: {
	readonly lookup: (
		accountId: string
	) => Promise<PublicEligibleObservation | null>;
	readonly canonicalLedger: Pick<FullHistoryCanonicalRepository, 'findLedger'>;
	readonly retained: RetainedReader;
	readonly recentWithinMs: number;
	readonly now?: () => number;
}) {
	if (!Number.isSafeInteger(recentWithinMs) || recentWithinMs <= 0)
		throw new Error('Invalid account protocol observation age policy');

	return {
		async execute(accountId: string): Promise<Result> {
			if (!isProtocolPositionAccount(accountId))
				throw new Error('Invalid protocol position account');
			const scope = {
				network: 'mainnet',
				accountId,
				target,
				coverage,
				includedInCurrentTotals: false
			} as const;
			const unavailable = {
				...scope,
				status: 'unavailable',
				asOf: null
			} as const;
			try {
				const selected = await lookup(accountId);
				if (!selected || !matchesSelection(selected, accountId))
					return unavailable;

				const snapshot = { ...selected.snapshot };
				const accountSha256 = selected.accountSha256;
				const closedAt = selected.ledgerClosedAt.getTime();
				if (!Number.isFinite(closedAt) || closedAt <= 0 || closedAt > now())
					return unavailable;
				const sequence = fullHistoryLedgerSequence(String(snapshot.ledger));
				const canonical = await canonicalLedger.findLedger(
					Networks.PUBLIC,
					sequence
				);
				if (
					!canonical ||
					canonical.ledgerSequence !== sequence ||
					canonical.ledgerHash.toHex() !== snapshot.ledgerHash ||
					canonical.closedAt.getTime() !== closedAt
				)
					return unavailable;

				const result = await retained.read(
					{ accountId, snapshot },
					accountSha256
				);
				if (result.status !== 'retained') return unavailable;
				const { position } = result;
				if (
					position.accountId !== accountId ||
					position.poolId !== poolId ||
					position.snapshot.networkId !== snapshot.networkId ||
					position.snapshot.ledger !== snapshot.ledger ||
					position.snapshot.ledgerHash !== snapshot.ledgerHash
				)
					return unavailable;

				const ageMs = now() - closedAt;
				if (!Number.isFinite(ageMs) || ageMs < 0) return unavailable;
				const asOf: AsOf = {
					ledger: snapshot.ledger,
					ledgerHash: snapshot.ledgerHash,
					closedAt: new Date(closedAt).toISOString(),
					ageSeconds: Math.floor(ageMs / 1000),
					freshness: ageMs <= recentWithinMs ? 'recent' : 'historical'
				};
				if (position.status === 'unobserved')
					return { ...scope, status: 'unobserved', asOf };
				const rateTime = position.underlyingEstimate.rateUpdatedAtEpochSeconds;
				if (
					position.rawEvidenceSha256 !== accountSha256 ||
					position.wasmSha256 !== wasmSha256 ||
					position.assetId !== target.assetId ||
					position.assetContractId !== target.assetContractId ||
					position.reserveIndex !== target.reserveIndex ||
					!/^(0|[1-9]\d{0,19})$/.test(rateTime) ||
					BigInt(rateTime) > BigInt(Math.floor(closedAt / 1000))
				)
					return unavailable;
				return {
					...scope,
					status: 'observed',
					asOf,
					position: derivedPosition(position)
				};
			} catch {
				return unavailable;
			}
		}
	};
}

function matchesSelection(
	selected: PublicEligibleObservation,
	accountId: string
): boolean {
	const { snapshot } = selected;
	return (
		selected.state === 'completed' &&
		selected.display === 'public_derived' &&
		selected.accountId === accountId &&
		selected.poolId === poolId &&
		selected.assetId === target.assetId &&
		selected.reserveIndex === target.reserveIndex &&
		selected.wasmSha256 === wasmSha256 &&
		snapshot.networkId === networkId &&
		Number.isInteger(snapshot.ledger) &&
		snapshot.ledger > 0 &&
		digestPattern.test(snapshot.ledgerHash) &&
		digestPattern.test(selected.accountSha256)
	);
}

import type { FullHistoryCanonicalRepository } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import { record } from '../../../status/infrastructure/http/contract-provenance/ContractBuildAttestation.js';
import {
	blendFixedSupplyAdapter,
	blendFixedSupplyTarget
} from '../../../status/infrastructure/soroban-positions/BlendFixedSupply.js';
import { createBlendRetainedSupplyReader } from '../../../status/infrastructure/soroban-positions/BlendRetainedSupply.js';
import type { SorobanEvidenceStore } from '../../../status/infrastructure/soroban-positions/SorobanEvidenceStore.js';
import {
	createGetExplorerAccountProtocolPosition,
	isProtocolPositionAccount,
	type PublicEligibleObservation
} from '../../use-cases/get-explorer-account-protocol-position/GetExplorerAccountProtocolPosition.js';
import { createExplorerAccountProtocolPositionHandler } from './ExplorerAccountProtocolPositionHandler.js';

const maxReferences = 16;
const digestPattern = /^[a-f0-9]{64}$/;
const { networkId, poolId, wasmSha256 } = blendFixedSupplyTarget;

export function validatePublicProtocolPositionReferences(
	references: unknown
): references is readonly unknown[] {
	if (
		!Array.isArray(references) ||
		!references.length ||
		references.length > maxReferences
	)
		return false;
	const accounts = new Set<string>();
	for (const reference of references) {
		const value = record(reference);
		const { accountId } = value;
		if (
			Object.keys(value).length !== 11 ||
			Object.keys(record(value.snapshot)).length !== 3 ||
			!isProtocolPositionAccount(accountId) ||
			accounts.has(accountId) ||
			!eligibleReference(value, accountId)
		)
			return false;
		accounts.add(accountId);
	}
	return true;
}

/**
 * Explicit, unmounted composition for a bounded server-owned reference list.
 * The list is the operator's approval for derived public display. Evidence
 * files alone do not establish that approval. There is no discovery or
 * account-to-digest index, and the store capability can only read.
 */
export function composeExplorerAccountProtocolPositionHandler({
	references,
	store,
	canonicalLedger,
	recentWithinMs,
	now
}: {
	readonly references: readonly unknown[];
	readonly store: Pick<SorobanEvidenceStore, 'readBlendEvidence'>;
	readonly canonicalLedger: Pick<FullHistoryCanonicalRepository, 'findLedger'>;
	readonly recentWithinMs: number;
	readonly now?: () => number;
}): ReturnType<typeof createExplorerAccountProtocolPositionHandler> {
	if (!Array.isArray(references) || references.length > maxReferences)
		throw new Error('Invalid account protocol reference list size');

	const selected = references.flatMap((value) => {
		const candidate = record(value);
		const { accountId } = candidate;
		return isProtocolPositionAccount(accountId)
			? [{ accountId, observation: eligibleReference(candidate, accountId) }]
			: [];
	});

	const useCase = createGetExplorerAccountProtocolPosition({
		async lookup(accountId) {
			const matches = selected.filter((entry) => entry.accountId === accountId);
			// Ambiguous selections fail closed, including a private duplicate.
			return matches.length === 1 ? (matches[0]?.observation ?? null) : null;
		},
		canonicalLedger,
		retained: createBlendRetainedSupplyReader(store),
		recentWithinMs,
		now
	});
	return createExplorerAccountProtocolPositionHandler(useCase);
}

function eligibleReference(
	value: Record<string, unknown>,
	accountId: string
): PublicEligibleObservation | null {
	const { accountSha256, ledgerClosedAt } = value;
	const {
		ledger,
		ledgerHash,
		networkId: observedNetwork
	} = record(value.snapshot);
	if (
		value.state !== 'completed' ||
		value.display !== 'public_derived' ||
		value.protocol !== blendFixedSupplyAdapter ||
		value.poolId !== poolId ||
		value.assetId !== 'native' ||
		value.reserveIndex !== 0 ||
		value.wasmSha256 !== wasmSha256 ||
		observedNetwork !== networkId ||
		typeof ledger !== 'number' ||
		!Number.isInteger(ledger) ||
		ledger <= 0 ||
		ledger > 0xffff_ffff ||
		typeof ledgerHash !== 'string' ||
		!digestPattern.test(ledgerHash) ||
		typeof accountSha256 !== 'string' ||
		!digestPattern.test(accountSha256) ||
		typeof ledgerClosedAt !== 'string'
	)
		return null;
	const closedAt = new Date(ledgerClosedAt);
	if (
		!Number.isFinite(closedAt.getTime()) ||
		closedAt.toISOString() !== ledgerClosedAt
	)
		return null;

	return {
		state: 'completed',
		display: 'public_derived',
		accountId,
		poolId,
		assetId: 'native',
		reserveIndex: 0,
		wasmSha256,
		snapshot: { networkId, ledger, ledgerHash },
		ledgerClosedAt: closedAt,
		accountSha256
	};
}

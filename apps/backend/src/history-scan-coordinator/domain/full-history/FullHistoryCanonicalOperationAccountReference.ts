import { extractBaseAddress, StrKey } from '@stellar/stellar-sdk';
import type { FullHistoryOperationInput } from './FullHistoryCanonicalOperation.js';
import {
	assertInteger,
	type FullHistoryHash,
	type FullHistoryLedgerSequence
} from './FullHistoryCanonicalTypes.js';

export const FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE =
	'operation_body_and_envelope_account_references' as const;
export const FULL_HISTORY_MAX_OPERATION_ACCOUNT_REFERENCES_PER_CHECKPOINT = 11_000_000;

export const FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_ROLES = [
	'claimant',
	'clawback_source',
	'destination',
	'effective_source',
	'inflation_destination',
	'offer_seller',
	'sponsored_account',
	'sponsorship_account',
	'trustor'
] as const;

export type FullHistoryOperationAccountReferenceFactScope =
	typeof FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE;
export type FullHistoryOperationAccountReferenceRole =
	(typeof FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_ROLES)[number];

export interface FullHistoryOperationAccountReferenceInput {
	readonly accountId: string;
	readonly baseAccountId: string;
	readonly factScope: FullHistoryOperationAccountReferenceFactScope;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly operationIndex: number;
	readonly role: FullHistoryOperationAccountReferenceRole;
	readonly transactionHash: FullHistoryHash;
	readonly transactionIndex: number;
}

export interface FullHistoryOperationAccountReferenceView {
	readonly accountId: string;
	readonly baseAccountId: string;
	readonly role: FullHistoryOperationAccountReferenceRole;
}

export class FullHistoryOperationAccountReferenceCoverageError extends Error {
	constructor() {
		super('Canonical operation account-reference coverage is incomplete');
		this.name = 'FullHistoryOperationAccountReferenceCoverageError';
	}
}

const referenceRoles = new Set<string>(
	FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_ROLES
);

export function isFullHistoryOperationAccountReferenceRole(
	value: string
): value is FullHistoryOperationAccountReferenceRole {
	return referenceRoles.has(value);
}

export function fullHistoryOperationAccountReference(
	operation: Pick<
		FullHistoryOperationInput,
		'ledgerSequence' | 'operationIndex' | 'transactionHash' | 'transactionIndex'
	>,
	role: FullHistoryOperationAccountReferenceRole,
	accountId: string
): FullHistoryOperationAccountReferenceInput {
	return {
		accountId,
		baseAccountId: fullHistoryBaseAccountId(accountId),
		factScope: FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE,
		ledgerSequence: operation.ledgerSequence,
		operationIndex: operation.operationIndex,
		role,
		transactionHash: operation.transactionHash,
		transactionIndex: operation.transactionIndex
	};
}

export function fullHistoryBaseAccountId(accountId: string): string {
	if (!isFullHistoryOperationAccountId(accountId)) {
		throw new TypeError('Operation account reference must be a G or M StrKey');
	}
	return extractBaseAddress(accountId);
}

export function validateFullHistoryOperationAccountReferences(input: {
	readonly operationAccountReferences: readonly FullHistoryOperationAccountReferenceInput[];
	readonly operations: readonly FullHistoryOperationInput[];
}): void {
	if (
		input.operationAccountReferences.length < input.operations.length ||
		input.operationAccountReferences.length >
			FULL_HISTORY_MAX_OPERATION_ACCOUNT_REFERENCES_PER_CHECKPOINT
	) {
		throw new RangeError(
			'Canonical operation account-reference count is invalid'
		);
	}

	const operations = new Map(
		input.operations.map((operation) => [
			operationIdentity(operation),
			operation
		])
	);
	const effectiveSources = new Map<string, number>();
	const identities = new Set<string>();
	for (const reference of input.operationAccountReferences) {
		validateReference(reference);
		const identity = referenceIdentity(reference);
		const operation = operations.get(operationIdentity(reference));
		if (
			identities.has(identity) ||
			operation === undefined ||
			!referenceMatchesOperation(reference, operation) ||
			!roleMatchesOperation(reference.role, operation)
		) {
			throw new Error(
				'Canonical operation account reference is duplicated or mismatched'
			);
		}
		identities.add(identity);
		if (reference.role === 'effective_source') {
			if (reference.accountId !== operation.sourceAccount) {
				throw new Error(
					'Effective-source reference must match the canonical operation source'
				);
			}
			const operationKey = operationIdentity(operation);
			effectiveSources.set(
				operationKey,
				(effectiveSources.get(operationKey) ?? 0) + 1
			);
		}
	}

	for (const operation of input.operations) {
		if ((effectiveSources.get(operationIdentity(operation)) ?? 0) !== 1) {
			throw new Error(
				'Canonical operation account references must contain one effective source'
			);
		}
	}
}

function validateReference(
	reference: FullHistoryOperationAccountReferenceInput
): void {
	assertInteger(reference.operationIndex, 'operationIndex', 0);
	assertInteger(reference.transactionIndex, 'transactionIndex', 0);
	if (
		reference.factScope !== FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE
	) {
		throw new Error('Operation account-reference fact scope is unsupported');
	}
	if (!isFullHistoryOperationAccountReferenceRole(reference.role)) {
		throw new Error('Operation account-reference role is unsupported');
	}
	if (
		!isFullHistoryOperationAccountId(reference.accountId) ||
		!StrKey.isValidEd25519PublicKey(reference.baseAccountId) ||
		fullHistoryBaseAccountId(reference.accountId) !== reference.baseAccountId
	) {
		throw new Error('Operation account-reference identity is invalid');
	}
}

function isFullHistoryOperationAccountId(value: string): boolean {
	return (
		StrKey.isValidEd25519PublicKey(value) ||
		StrKey.isValidMed25519PublicKey(value)
	);
}

function roleMatchesOperation(
	role: FullHistoryOperationAccountReferenceRole,
	operation: FullHistoryOperationInput
): boolean {
	if (role === 'effective_source') return true;
	const allowedTypes = operationTypesByRole[role];
	return allowedTypes.includes(operation.operationType);
}

const operationTypesByRole: Readonly<
	Record<
		Exclude<FullHistoryOperationAccountReferenceRole, 'effective_source'>,
		readonly FullHistoryOperationInput['operationType'][]
	>
> = {
	claimant: ['create_claimable_balance'],
	clawback_source: ['clawback'],
	destination: [
		'account_merge',
		'create_account',
		'path_payment_strict_receive',
		'path_payment_strict_send',
		'payment'
	],
	inflation_destination: ['set_options'],
	offer_seller: ['revoke_sponsorship'],
	sponsored_account: ['begin_sponsoring_future_reserves'],
	sponsorship_account: ['revoke_sponsorship'],
	trustor: ['allow_trust', 'set_trust_line_flags']
};

function referenceMatchesOperation(
	reference: FullHistoryOperationAccountReferenceInput,
	operation: FullHistoryOperationInput
): boolean {
	return (
		reference.ledgerSequence === operation.ledgerSequence &&
		reference.operationIndex === operation.operationIndex &&
		reference.transactionIndex === operation.transactionIndex
	);
}

function operationIdentity(input: {
	readonly operationIndex: number;
	readonly transactionHash: FullHistoryHash;
}): string {
	return `${input.transactionHash.toHex()}:${input.operationIndex}`;
}

function referenceIdentity(
	reference: FullHistoryOperationAccountReferenceInput
): string {
	return `${operationIdentity(reference)}:${reference.role}:${reference.accountId}`;
}

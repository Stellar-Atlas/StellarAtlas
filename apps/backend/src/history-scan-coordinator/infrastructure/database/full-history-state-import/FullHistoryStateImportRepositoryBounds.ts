import type { EntityManager } from 'typeorm';
import type { FullHistoryStateImportClaimOrder } from '../../../domain/full-history-state-import/FullHistoryStateImport.js';

const maximumLeaseMilliseconds = 30 * 60_000;

export function assertFullHistoryStateImportClaimOrder(
	value: FullHistoryStateImportClaimOrder
): void {
	if (
		value !== 'canonical-first' &&
		value !== 'oldest-first' &&
		value !== 'recovery-first'
	) {
		throw new TypeError('State import claim order is invalid');
	}
}

export function assertFullHistoryStateImportLeaseDuration(value: number): void {
	if (
		!Number.isInteger(value) ||
		value < 10_000 ||
		value > maximumLeaseMilliseconds
	) {
		throw new TypeError('State import lease duration is outside its bounds');
	}
}

export async function setFullHistoryStateImportTransactionBounds(
	manager: EntityManager,
	statementTimeoutMilliseconds = 30_000
): Promise<void> {
	await manager.query(
		`select set_config('lock_timeout', '2000ms', true),
			set_config('statement_timeout', $1, true)`,
		[`${statementTimeoutMilliseconds}ms`]
	);
}

export function validFullHistoryStateImportAttemptCount(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError('State import attempt count is invalid');
	}
	return value;
}

export function validFullHistoryStateImportStorageKey(value: string): string {
	if (
		value.length === 0 ||
		value.length > 2_048 ||
		value.startsWith('/') ||
		value.includes('\\') ||
		value.split('/').some((part) => part.length === 0 || part === '..')
	) {
		throw new TypeError('State import storage key is invalid');
	}
	return value;
}

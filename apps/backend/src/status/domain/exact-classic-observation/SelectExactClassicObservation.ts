import { StrKey } from '@stellar/stellar-sdk';
import {
	ExactClassicObservationError,
	type BoundExactClassicObservation,
	type ExactClassicAsset,
	type ExactClassicObservation,
	type ExactClassicScope,
	type ExactClassicSelection,
	type ExactClassicSelectionResult,
	type ExactObservationImport
} from './ExactClassicObservation.js';

export const MAXIMUM_EXACT_OBSERVATIONS = 128;
export const MAXIMUM_EXACT_IMPORTS = 16;
const phases = {
	fee: 0,
	transaction: 1,
	operation: 1,
	fee_refund: 2,
	upgrade: 3
} as const;
const int64Maximum = 9223372036854775807n;
const uint32Maximum = 4294967295n;
function invalid(field: string): never {
	throw new ExactClassicObservationError(
		'invalid_input',
		'Invalid exact observation ' + field
	);
}
function conflict(): never {
	throw new ExactClassicObservationError(
		'conflicting_evidence',
		'Contradictory exact observation evidence'
	);
}

function decimal(value: string, maximum: bigint, minimum = 0n): bigint {
	if (
		typeof value !== 'string' ||
		value.length > maximum.toString().length ||
		!/^(0|[1-9]\d*)$/.test(value)
	)
		invalid('decimal');
	const result = BigInt(value);
	if (result < minimum || result > maximum) invalid('decimal range');
	return result;
}
function digest(value: string): void {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
		invalid('digest');
}
function account(value: string): void {
	if (typeof value !== 'string' || !StrKey.isValidEd25519PublicKey(value))
		invalid('account');
}
function asset(value: ExactClassicAsset): ExactClassicAsset {
	if (!value || typeof value !== 'object') invalid('asset');
	if (value.kind === 'native') return Object.freeze({ kind: 'native' });
	if (
		value.kind !== 'issued' ||
		typeof value.code !== 'string' ||
		!/^[A-Za-z0-9]{1,12}$/.test(value.code)
	)
		invalid('classic asset');
	account(value.issuer);
	return Object.freeze({
		kind: 'issued',
		code: value.code,
		issuer: value.issuer
	});
}
function sameAsset(a: ExactClassicAsset, b: ExactClassicAsset): boolean {
	return (
		a.kind === b.kind &&
		(a.kind === 'native' ||
			(b.kind === 'issued' && a.code === b.code && a.issuer === b.issuer))
	);
}
function batchId(value: string): void {
	if (
		typeof value !== 'string' ||
		!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)
	)
		invalid('batch identity');
}

interface Parsed {
	readonly value: ExactClassicObservation;
	readonly ledger: bigint;
	readonly phase: number;
	readonly transaction: bigint;
	readonly change: bigint;
	readonly upgrade: bigint | null;
	readonly operation: bigint | null;
	readonly signature: string;
}
const compare = (a: bigint | number, b: bigint | number): number =>
	a < b ? -1 : a > b ? 1 : 0;
function ordered(a: Parsed, b: Parsed): number {
	return (
		compare(a.ledger, b.ledger) ||
		compare(a.phase, b.phase) ||
		compare(a.transaction, b.transaction) ||
		compare(a.change, b.change)
	);
}

/**
 * Select only within the caller-declared bounded typed scope. Validates binding
 * consistency, not row hashes, import manifests, consensus or database coverage.
 * An adapter must establish those independently; no SQL/network is performed.
 */
export function selectExactClassicObservation(
	input: ExactClassicSelection
): ExactClassicSelectionResult {
	if (
		!input ||
		!input.scope ||
		!input.coverage ||
		!Array.isArray(input.observations) ||
		!Array.isArray(input.imports)
	)
		invalid('selection');
	if (
		input.observations.length > MAXIMUM_EXACT_OBSERVATIONS ||
		input.imports.length > MAXIMUM_EXACT_IMPORTS
	)
		invalid('input bound');
	const observations: readonly BoundExactClassicObservation[] =
		input.observations;
	const inputImports: readonly ExactObservationImport[] = input.imports;
	digest(input.scope.networkHash);
	account(input.scope.account);
	const scope: ExactClassicScope = Object.freeze({
		networkHash: input.scope.networkHash,
		account: input.scope.account,
		asset: asset(input.scope.asset),
		firstLedger: input.scope.firstLedger,
		lastLedger: input.scope.lastLedger
	});
	const first = decimal(scope.firstLedger, uint32Maximum, 1n),
		last = decimal(scope.lastLedger, uint32Maximum, 1n);
	if (first > last) invalid('scope range');
	const coverage = input.coverage;
	if (
		!['complete', 'partial', 'unknown'].includes(coverage.status) ||
		typeof coverage.truncated !== 'boolean'
	)
		invalid('coverage');
	if (
		coverage.expectedDistinctObservations !== null &&
		(!Number.isSafeInteger(coverage.expectedDistinctObservations) ||
			coverage.expectedDistinctObservations < 0 ||
			coverage.expectedDistinctObservations > Number(uint32Maximum))
	)
		invalid('coverage count');
	const imports = new Map<string, ExactObservationImport>();
	let importsComplete = input.imports.length > 0;
	for (const source of inputImports) {
		batchId(source.batchId);
		digest(source.networkHash);
		digest(source.sourceDigest);
		if (source.networkHash !== scope.networkHash) invalid('network binding');
		if (
			!['complete', 'pending', 'failed'].includes(source.status) ||
			!['visible', 'hidden'].includes(source.visibility)
		)
			invalid('import state');
		if (source.verifiedSourceDigest !== null) {
			digest(source.verifiedSourceDigest);
			if (source.verifiedSourceDigest !== source.sourceDigest)
				invalid('content binding');
		}
		if (
			decimal(source.firstLedger, uint32Maximum, 1n) >
			decimal(source.lastLedger, uint32Maximum, 1n)
		)
			invalid('import range');
		const previous = imports.get(source.batchId);
		if (
			previous &&
			JSON.stringify([
				previous.networkHash,
				previous.sourceDigest,
				previous.verifiedSourceDigest,
				previous.status,
				previous.visibility,
				previous.firstLedger,
				previous.lastLedger
			]) !==
				JSON.stringify([
					source.networkHash,
					source.sourceDigest,
					source.verifiedSourceDigest,
					source.status,
					source.visibility,
					source.firstLedger,
					source.lastLedger
				])
		)
			conflict();
		imports.set(source.batchId, source);
		importsComplete =
			importsComplete &&
			source.status === 'complete' &&
			source.visibility === 'visible' &&
			source.verifiedSourceDigest === source.sourceDigest;
	}
	let coveredThrough = first - 1n;
	for (const source of [...imports.values()].sort((a, b) =>
		compare(BigInt(a.firstLedger), BigInt(b.firstLedger))
	)) {
		if (BigInt(source.firstLedger) > coveredThrough + 1n) break;
		if (BigInt(source.lastLedger) > coveredThrough)
			coveredThrough = BigInt(source.lastLedger);
	}
	importsComplete = importsComplete && coveredThrough >= last;
	const unique = new Map<string, Parsed>();
	for (const row of observations) {
		digest(row.networkHash);
		account(row.account);
		digest(row.sourceDigest);
		digest(row.rowDigest);
		if (
			row.networkHash !== scope.networkHash ||
			row.account !== scope.account ||
			!sameAsset(asset(row.asset), scope.asset)
		)
			invalid('row scope');
		const source = imports.get(row.batchId);
		if (!source || row.sourceDigest !== source.sourceDigest)
			invalid('row import binding');
		const ledger = decimal(row.ledgerSequence, uint32Maximum, 1n),
			transaction = decimal(row.transactionIndex, uint32Maximum),
			change = decimal(row.changeIndex, uint32Maximum, 1n);
		if (
			ledger < first ||
			ledger > last ||
			ledger < BigInt(source.firstLedger) ||
			ledger > BigInt(source.lastLedger)
		)
			invalid('row range');
		if (!Object.hasOwn(phases, row.reason)) invalid('change reason');
		const phase = phases[row.reason];
		const upgrade =
			row.upgradeIndex === null
				? null
				: decimal(row.upgradeIndex, uint32Maximum, 1n);
		const operation =
			row.operationIndex === null
				? null
				: decimal(row.operationIndex, uint32Maximum, 1n);
		if (
			phase === 3
				? transaction !== 0n || upgrade === null || operation !== null
				: transaction === 0n ||
					upgrade !== null ||
					(row.reason === 'operation') !== (operation !== null)
		)
			invalid('change provenance');
		if (
			typeof row.deleted !== 'boolean' ||
			!['created', 'updated', 'removed', 'restored'].includes(row.changeKind) ||
			row.deleted !== (row.changeKind === 'removed')
		)
			invalid('deletion');
		for (const raw of [
			row.balanceRaw,
			row.buyingLiabilitiesRaw,
			row.sellingLiabilitiesRaw
		])
			decimal(raw, int64Maximum);
		const value: ExactClassicObservation = Object.freeze({
			ledgerSequence: row.ledgerSequence,
			transactionIndex: row.transactionIndex,
			changeIndex: row.changeIndex,
			reason: row.reason,
			operationIndex: row.operationIndex,
			upgradeIndex: row.upgradeIndex,
			changeKind: row.changeKind,
			deleted: row.deleted,
			balanceRaw: row.balanceRaw,
			buyingLiabilitiesRaw: row.buyingLiabilitiesRaw,
			sellingLiabilitiesRaw: row.sellingLiabilitiesRaw,
			scale: 7,
			precision: 'exact-atomic-observation',
			source: Object.freeze({
				batchId: row.batchId,
				sourceDigest: row.sourceDigest,
				rowDigest: row.rowDigest
			})
		});
		const signature = JSON.stringify(value),
			key = [ledger, phase, transaction, change].join(':');
		const previous = unique.get(key);
		if (previous && previous.signature !== signature) conflict();
		unique.set(key, {
			value,
			ledger,
			phase,
			transaction,
			change,
			upgrade,
			operation,
			signature
		});
	}
	const rows = [...unique.values()].sort(ordered);
	// Bounded quadratic validation catches impossible cross-phase/global indices.
	for (let i = 0; i < rows.length; i++)
		for (let j = i + 1; j < rows.length; j++) {
			const a = rows[i],
				b = rows[j];
			if (a.ledger !== b.ledger) continue;
			if (a.phase === 3 && b.phase === 3 && a.upgrade! > b.upgrade!)
				invalid('upgrade order');
			if (a.phase !== 3 && b.phase !== 3 && a.transaction === b.transaction) {
				if (a.phase < b.phase && a.change >= b.change)
					invalid('phase change order');
				if (
					a.operation !== null &&
					b.operation !== null &&
					a.operation > b.operation
				)
					invalid('operation order');
			}
		}
	const incompleteReasons: ('coverage' | 'truncated' | 'count' | 'imports')[] =
		[];
	if (coverage.status !== 'complete') incompleteReasons.push('coverage');
	if (coverage.truncated) incompleteReasons.push('truncated');
	if (coverage.expectedDistinctObservations !== rows.length)
		incompleteReasons.push('count');
	if (!importsComplete) incompleteReasons.push('imports');
	const observation =
		incompleteReasons.length === 0 ? (rows.at(-1)?.value ?? null) : null;
	return Object.freeze({
		scope,
		observation,
		distinctObservations: rows.length,
		state: incompleteReasons.length
			? 'incomplete'
			: observation === null
				? 'no-observation'
				: observation.deleted
					? 'deleted'
					: 'present',
		incompleteReasons: Object.freeze(incompleteReasons),
		currentChainState: false,
		snapshotPinned: false
	});
}

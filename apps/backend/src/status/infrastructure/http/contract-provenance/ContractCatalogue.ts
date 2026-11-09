import { createHash } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import {
	githubRepository,
	type ContractBuildRecord
} from './ContractBuildAttestation.js';
import type { ContractProvenance } from './ContractProvenanceService.js';

export interface ContractCatalogueItem {
	readonly contractId: string;
	readonly observedLedger: number;
	readonly instanceModifiedLedger: number | null;
	readonly checkedAt: string;
	readonly wasmSha256: string;
	readonly ledgerEvidence: 'configured_rpc_observation';
	readonly build: {
		readonly status: 'verified';
		readonly record: ContractBuildRecord;
	};
	readonly independentReproduction: 'not_assessed';
	readonly securityAudit: 'not_assessed';
}

export interface ContractCataloguePage {
	readonly version: 1;
	readonly networkPassphrase: string;
	readonly items: readonly ContractCatalogueItem[];
	readonly nextCursor: string | null;
}

type CatalogueFilter =
	| { readonly kind: 'all' }
	| { readonly kind: 'contract'; readonly contractId: string }
	| { readonly kind: 'repository'; readonly prefix: string };

interface CataloguePosition {
	readonly contractId: string;
	readonly repositoryKey: string | null;
}

export interface ContractCatalogueQuery {
	readonly filter: CatalogueFilter;
	readonly limit: number;
	readonly after: CataloguePosition | null;
	readonly scope: string;
}

const repositoryPrefix = /^[a-z0-9][a-z0-9-]{0,38}(?:\/[a-z0-9_.-]{0,100})?$/;
const cursorPattern = /^[A-Za-z0-9_-]{1,512}$/;
const sha256 = (value: string): string =>
	createHash('sha256').update(value).digest('hex');

export const catalogueNetworkKey = sha256;

export function readCatalogueQuery(
	query: Record<string, unknown>,
	networkPassphrase: string
): ContractCatalogueQuery | null {
	if (Object.keys(query).some((key) => !['q', 'limit', 'cursor'].includes(key)))
		return null;
	const { q, limit, cursor } = query;
	if (
		q !== undefined &&
		(typeof q !== 'string' || q.length > 140 || /[^\x20-\x7e]/.test(q))
	)
		return null;
	if (
		limit !== undefined &&
		(typeof limit !== 'string' || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit))
	)
		return null;
	const input = typeof q === 'string' ? q.trim() : '';
	const prefix = input.toLowerCase();
	let filter: CatalogueFilter;
	if (!input) filter = { kind: 'all' };
	else if (input.length === 56 && StrKey.isValidContract(input))
		filter = { kind: 'contract', contractId: input };
	else if (repositoryPrefix.test(prefix))
		filter = { kind: 'repository', prefix };
	else return null;

	const scope = sha256(JSON.stringify([networkPassphrase, filter]));
	const after =
		cursor === undefined ? null : decodePosition(cursor, scope, filter);
	if (cursor !== undefined && after === null) return null;
	return {
		filter,
		limit: limit === undefined ? 25 : Number(limit),
		after,
		scope
	};
}

function decodePosition(
	cursor: unknown,
	scope: string,
	filter: CatalogueFilter
): CataloguePosition | null {
	if (
		filter.kind === 'contract' ||
		typeof cursor !== 'string' ||
		!cursorPattern.test(cursor)
	)
		return null;
	try {
		const bytes = Buffer.from(cursor, 'base64url');
		if (bytes.toString('base64url') !== cursor) return null;
		const payload: unknown = JSON.parse(bytes.toString('utf8'));
		if (!Array.isArray(payload) || payload.length !== 4) return null;
		const [version, cursorScope, contractId, repositoryKey] =
			payload as unknown[];
		if (
			version !== 1 ||
			cursorScope !== scope ||
			typeof contractId !== 'string' ||
			contractId.length !== 56 ||
			!StrKey.isValidContract(contractId)
		)
			return null;
		if (filter.kind === 'all')
			return repositoryKey === null ? { contractId, repositoryKey } : null;
		if (
			typeof repositoryKey !== 'string' ||
			repositoryKey !== repositoryKey.toLowerCase() ||
			githubRepository('github:' + repositoryKey) !== repositoryKey ||
			!repositoryKey.startsWith(filter.prefix)
		)
			return null;
		return { contractId, repositoryKey };
	} catch {
		return null;
	}
}

export function catalogueCursor(
	query: ContractCatalogueQuery,
	item: ContractCatalogueItem
): string {
	const repository =
		query.filter.kind === 'repository'
			? item.build.record.repository.toLowerCase()
			: null;
	return Buffer.from(
		JSON.stringify([1, query.scope, item.contractId, repository])
	).toString('base64url');
}

export function projectCatalogueItem(
	value: ContractProvenance
): ContractCatalogueItem | null {
	const {
		build,
		contractId,
		executable,
		wasmSha256,
		observedLedger,
		instanceModifiedLedger,
		checkedAt,
		ledgerEvidence
	} = value;
	if (
		ledgerEvidence !== 'configured_rpc_observation' ||
		executable !== 'wasm' ||
		build.status !== 'verified' ||
		build.record === null ||
		!StrKey.isValidContract(contractId) ||
		!wasmSha256 ||
		!/^[a-f0-9]{64}$/.test(wasmSha256) ||
		!Number.isInteger(observedLedger) ||
		observedLedger < 1 ||
		observedLedger > 0xffffffff ||
		(instanceModifiedLedger !== null &&
			(!Number.isInteger(instanceModifiedLedger) ||
				instanceModifiedLedger < 1 ||
				instanceModifiedLedger > observedLedger)) ||
		!Number.isFinite(Date.parse(checkedAt))
	)
		return null;

	const { repository, commit, sourceUrl, workflowUrl, runUrl, attestationUrl } =
		build.record;
	if (
		githubRepository('github:' + repository) !== repository ||
		value.metadata.sourceRepository !== repository ||
		!/^[a-f0-9]{40}$/.test(commit)
	)
		return null;
	// Copy only links and identifiers produced by the accepted attestation verifier.
	const record = {
		repository,
		commit,
		sourceUrl,
		workflowUrl,
		runUrl,
		attestationUrl
	};
	if (Buffer.byteLength(JSON.stringify(record)) > 4096) return null;
	return {
		contractId,
		observedLedger,
		instanceModifiedLedger,
		checkedAt,
		wasmSha256,
		ledgerEvidence,
		build: { status: 'verified', record },
		independentReproduction: 'not_assessed',
		securityAudit: 'not_assessed'
	};
}

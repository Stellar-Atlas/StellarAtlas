import { createHash } from 'node:crypto';
import { hash, StrKey } from '@stellar/stellar-sdk';
import { githubRepository } from '../contract-provenance/ContractBuildAttestation.js';
import type { ContractProvenance } from '../contract-provenance/ContractProvenanceService.js';

export const MAX_EXTERNAL_VERIFICATION_BYTES = 8 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;
const decoder = new TextDecoder('utf-8', { fatal: true });
const envelopeFields = new Set([
	'version',
	'publisher',
	'recordId',
	'networkId',
	'contractId',
	'wasmSha256',
	'fetchedAt',
	'reportedAt',
	'observedLedger',
	'providerStatus',
	'sourceRepo',
	'sourceCommit',
	'package',
	'sourcePath',
	'claimedMethod',
	'claimedSigner',
	'evidenceUrls'
]);

type ClaimedMethod = 'publisher_attestation' | 'reproducible_build';

export interface ExpertValidationObservation {
	readonly kind: 'external_report';
	readonly source: 'stellar-expert/verification';
	readonly publisher: 'StellarExpert';
	readonly recordId: string;
	readonly envelopeSha256: string;
	readonly networkId: string;
	readonly contractId: string;
	readonly wasmSha256: string | null;
	readonly fetchedAt: string;
	readonly reportedAt: string | null;
	readonly observedLedger: number | null;
	readonly providerStatus: string;
	readonly repository: string | null;
	readonly commit: string | null;
	readonly package: string | null;
	readonly sourcePath: string | null;
	readonly claimedMethod: ClaimedMethod | null;
	readonly claimedSigner: string | null;
	readonly evidenceUrls: readonly string[];
}

export type ExpertObservationBinding =
	| 'unavailable'
	| 'network_mismatch'
	| 'contract_mismatch'
	| 'unbound'
	| 'reference_behind'
	| 'historical'
	| 'code_mismatch'
	| 'stale'
	| 'matches_reference';

type ChainReference = Pick<
	ContractProvenance,
	| 'networkPassphrase'
	| 'contractId'
	| 'observedLedger'
	| 'instanceModifiedLedger'
	| 'executable'
	| 'wasmSha256'
>;

export class InvalidExpertObservation extends Error {}

/** Parse Atlas's offline v1 envelope. Provider wire formats and trust checks are separate. */
export function parseExpertValidationObservation(
	bytes: Uint8Array
): ExpertValidationObservation {
	const byteLength = bytes instanceof Uint8Array ? bytes.byteLength : 0;
	if (byteLength < 1 || byteLength > MAX_EXTERNAL_VERIFICATION_BYTES)
		throw new InvalidExpertObservation(
			'Invalid verification observation byte length'
		);
	// Copy only the validated length, even if the caller's backing buffer grows.
	const snapshot = Buffer.from(
		new Uint8Array(bytes.buffer, bytes.byteOffset, byteLength)
	);
	const raw = decodeEnvelope(snapshot);
	if (raw.version !== 1 || raw.publisher !== 'StellarExpert')
		throw new InvalidExpertObservation(
			'Unsupported verification observation envelope'
		);
	const recordId = checkedText(
		raw.recordId,
		'recordId',
		128,
		/^[A-Za-z0-9][A-Za-z0-9._:-]*$/
	);
	const networkId = checkedText(raw.networkId, 'networkId', 64, sha256Pattern);
	const contractId = checkedText(raw.contractId, 'contractId', 56);
	if (!StrKey.isValidContract(contractId))
		throw new InvalidExpertObservation('Invalid verification contract address');
	const wasmSha256 =
		raw.wasmSha256 === null
			? null
			: checkedText(raw.wasmSha256, 'wasmSha256', 64, sha256Pattern);
	const fetchedAt = checkedTime(raw.fetchedAt, 'fetchedAt');
	const reportedAt =
		raw.reportedAt == null ? null : checkedTime(raw.reportedAt, 'reportedAt');
	if (reportedAt && reportedAt > fetchedAt)
		throw new InvalidExpertObservation(
			'Reported observation time follows fetch time'
		);
	const observedLedger = raw.observedLedger ?? null;
	if (observedLedger !== null && !isLedger(observedLedger))
		throw new InvalidExpertObservation(
			'Invalid verification observation ledger'
		);
	const sourceRepo = optionalText(raw.sourceRepo, 'sourceRepo', 147);
	const repository = githubRepository(sourceRepo);
	const commit = optionalText(
		raw.sourceCommit,
		'sourceCommit',
		40,
		/^[a-f0-9]{40}$/
	);
	const packageName = optionalText(
		raw.package,
		'package',
		128,
		/^[A-Za-z0-9][A-Za-z0-9_-]*$/
	);
	const sourcePath = optionalText(raw.sourcePath, 'sourcePath', 240);
	if (
		(sourceRepo && !repository) ||
		(!repository && (commit || packageName || sourcePath))
	)
		throw new InvalidExpertObservation(
			'Invalid verification source repository binding'
		);
	if (sourcePath && (sourcePath.includes(':') || !safePath(sourcePath)))
		throw new InvalidExpertObservation('Invalid verification source path');
	const claimedMethod = raw.claimedMethod ?? null;
	if (
		claimedMethod !== null &&
		claimedMethod !== 'publisher_attestation' &&
		claimedMethod !== 'reproducible_build'
	)
		throw new InvalidExpertObservation('Invalid claimed verification method');
	return {
		kind: 'external_report',
		source: 'stellar-expert/verification',
		publisher: 'StellarExpert',
		recordId,
		envelopeSha256: createHash('sha256').update(snapshot).digest('hex'),
		networkId,
		contractId,
		wasmSha256,
		fetchedAt,
		reportedAt,
		observedLedger,
		providerStatus: checkedText(raw.providerStatus, 'providerStatus', 80),
		repository,
		commit,
		package: packageName,
		sourcePath,
		claimedMethod,
		claimedSigner: optionalText(raw.claimedSigner, 'claimedSigner', 256),
		evidenceUrls: readEvidenceUrls(raw.evidenceUrls)
	};
}

/** Assess the external report against one supplied chain reference and an explicit freshness policy. */
export function assessExpertValidationObservation(
	observation: ExpertValidationObservation | null,
	reference: ChainReference | null,
	policy: { readonly asOf: string; readonly maxAgeMs: number }
): ExpertObservationBinding {
	const asOf = Date.parse(checkedTime(policy.asOf, 'asOf'));
	if (!Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs < 1)
		throw new InvalidExpertObservation('Invalid verification freshness policy');
	if (!observation || !reference) return 'unavailable';
	const networkId = Buffer.from(
		hash(Buffer.from(reference.networkPassphrase, 'utf8'))
	).toString('hex');
	if (observation.networkId !== networkId) return 'network_mismatch';
	if (observation.contractId !== reference.contractId)
		return 'contract_mismatch';
	if (!observation.wasmSha256) return 'unbound';
	if (
		reference.executable !== 'wasm' ||
		!reference.wasmSha256 ||
		!isLedger(reference.observedLedger)
	)
		return 'unavailable';
	const modified = reference.instanceModifiedLedger;
	if (
		modified !== null &&
		(!isLedger(modified) || modified > reference.observedLedger)
	)
		return 'unavailable';
	if (observation.observedLedger !== null) {
		if (observation.observedLedger > reference.observedLedger)
			return 'reference_behind';
		if (modified !== null && observation.observedLedger < modified)
			return 'historical';
	}
	if (observation.wasmSha256 !== reference.wasmSha256) return 'code_mismatch';
	const fetchedAt = Date.parse(observation.fetchedAt);
	const reportedAt = Date.parse(
		observation.reportedAt ?? observation.fetchedAt
	);
	if (fetchedAt > asOf) return 'unavailable';
	if (asOf - reportedAt > policy.maxAgeMs) return 'stale';
	return 'matches_reference';
}

function decodeEnvelope(bytes: Uint8Array): Record<string, unknown> {
	let text: string;
	let value: unknown;
	try {
		text = decoder.decode(bytes);
		value = JSON.parse(text);
	} catch {
		throw new InvalidExpertObservation(
			'Verification observation must be valid UTF-8 JSON'
		);
	}
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new InvalidExpertObservation(
			'Invalid verification observation envelope'
		);
	// Tokenize strings after JSON syntax validation to detect repeated keys, including escaped names.
	const keys = new Set<string>();
	for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/gs)) {
		if (!/^\s*:/.test(text.slice(token.index + token[0].length))) continue;
		const key: string = JSON.parse(token[0]);
		if (!envelopeFields.has(key) || keys.has(key))
			throw new InvalidExpertObservation(
				'Unknown or repeated verification observation field'
			);
		keys.add(key);
	}
	return value as Record<string, unknown>;
}

function checkedText(
	value: unknown,
	field: string,
	maxLength: number,
	pattern?: RegExp
): string {
	if (
		typeof value !== 'string' ||
		!value.length ||
		value.length > maxLength ||
		value.trim() !== value ||
		/[<>\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]/u.test(value) ||
		(pattern && !pattern.test(value))
	)
		throw new InvalidExpertObservation('Invalid verification field ' + field);
	return value;
}

function optionalText(
	value: unknown,
	field: string,
	maxLength: number,
	pattern?: RegExp
): string | null {
	return value == null ? null : checkedText(value, field, maxLength, pattern);
}

function checkedTime(value: unknown, field: string): string {
	const text = checkedText(
		value,
		field,
		24,
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
	);
	const date = new Date(text);
	if (!Number.isFinite(date.getTime()) || date.toISOString() !== text)
		throw new InvalidExpertObservation('Invalid verification field ' + field);
	return text;
}

function isLedger(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= 0xffffffff
	);
}

function safePath(path: string): boolean {
	return path
		.split('/')
		.every(
			(part) =>
				/^[A-Za-z0-9_.:@-]+$/.test(part) && part !== '.' && part !== '..'
		);
}

function readEvidenceUrls(value: unknown): readonly string[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || value.length > 4)
		throw new InvalidExpertObservation('Invalid verification evidence links');
	return value.map((candidate: unknown) => {
		const text = checkedText(candidate, 'evidenceUrls', 512);
		const match =
			/^https:\/\/(?:github\.com|api\.github\.com|stellar\.expert|api\.stellar\.expert)\/(.+)$/.exec(
				text
			);
		if (!match?.[1] || !safePath(match[1]))
			throw new InvalidExpertObservation('Unsafe verification evidence link');
		return text;
	});
}

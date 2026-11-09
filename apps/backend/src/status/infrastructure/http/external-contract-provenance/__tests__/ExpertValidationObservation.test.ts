import { createHash } from 'node:crypto';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import type { ContractProvenance } from '../../contract-provenance/ContractProvenanceService.js';
import {
	assessExpertValidationObservation,
	InvalidExpertObservation,
	MAX_EXTERNAL_VERIFICATION_BYTES,
	parseExpertValidationObservation
} from '../ExpertValidationObservation.js';

const hash = (bytes: string | Uint8Array) =>
	createHash('sha256').update(bytes).digest('hex');
const contractId = StrKey.encodeContract(Buffer.alloc(32, 1));
const wasmSha256 = hash('synthetic wasm identity');
const commit = 'a'.repeat(40);
const fetchedAt = '2026-11-05T16:00:00.000Z';
const envelope = {
	version: 1,
	publisher: 'StellarExpert',
	recordId: 'example:version-1',
	networkId: hash(Networks.PUBLIC),
	contractId,
	wasmSha256,
	fetchedAt,
	reportedAt: '2026-11-05T15:55:00.000Z',
	observedLedger: 110,
	providerStatus: 'verified',
	sourceRepo: 'github:Example/Contract',
	sourceCommit: commit,
	package: 'example-contract',
	sourcePath: 'contracts/example',
	claimedMethod: 'publisher_attestation',
	claimedSigner: 'github-actions',
	evidenceUrls: [
		`https://github.com/Example/Contract/tree/${commit}`,
		`https://api.github.com/repos/Example/Contract/attestations/sha256:${wasmSha256}`
	]
};
const reference: ContractProvenance = {
	contractId,
	networkPassphrase: Networks.PUBLIC,
	observedLedger: 120,
	instanceModifiedLedger: 100,
	checkedAt: fetchedAt,
	executable: 'wasm',
	wasmSha256,
	metadata: { sourceRepository: null, homeDomain: null },
	build: { status: 'not_published', record: null },
	securityAudit: 'not_assessed'
};
const policy = { asOf: '2026-11-05T16:05:00.000Z', maxAgeMs: 60 * 60 * 1000 };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const report = (patch: Record<string, unknown> = {}) =>
	parseExpertValidationObservation(encode({ ...envelope, ...patch }));

it('preserves attribution, immutable source metadata and explicit code binding as an external report', () => {
	const bytes = encode(envelope);
	const value = parseExpertValidationObservation(bytes);
	expect(value).toEqual({
		kind: 'external_report',
		source: 'stellar-expert/verification',
		publisher: 'StellarExpert',
		recordId: envelope.recordId,
		envelopeSha256: hash(bytes),
		networkId: envelope.networkId,
		contractId,
		wasmSha256,
		fetchedAt,
		reportedAt: envelope.reportedAt,
		observedLedger: 110,
		providerStatus: 'verified',
		repository: 'Example/Contract',
		commit,
		package: envelope.package,
		sourcePath: envelope.sourcePath,
		claimedMethod: 'publisher_attestation',
		claimedSigner: envelope.claimedSigner,
		evidenceUrls: envelope.evidenceUrls
	});
	expect(assessExpertValidationObservation(value, reference, policy)).toBe(
		'matches_reference'
	);
	expect(reference.build).toEqual({ status: 'not_published', record: null });
	expect(value).not.toHaveProperty('build');
	const newer = report({ claimedMethod: 'reproducible_build' });
	expect(newer.kind).toBe('external_report');
	expect(newer.envelopeSha256).not.toBe(value.envelopeSha256);
});

it('never borrows a digest, build verdict or audit claim from Atlas or from the provider status', () => {
	const value = report({ wasmSha256: null, observedLedger: undefined });
	const atlasVerified: ContractProvenance = {
		...reference,
		build: {
			status: 'verified',
			record: {
				repository: 'Example/Contract',
				commit,
				sourceUrl: envelope.evidenceUrls[0]!,
				workflowUrl: envelope.evidenceUrls[0]!,
				runUrl: null,
				attestationUrl: envelope.evidenceUrls[1]!
			}
		}
	};
	expect(value.wasmSha256).toBeNull();
	expect(assessExpertValidationObservation(value, atlasVerified, policy)).toBe(
		'unbound'
	);
	expect(atlasVerified.build.status).toBe('verified');
	expect(value).not.toHaveProperty('securityAudit');
});

it('distinguishes network, contract and code mismatches', () => {
	expect(
		assessExpertValidationObservation(
			report(),
			{ ...reference, networkPassphrase: Networks.TESTNET },
			policy
		)
	).toBe('network_mismatch');
	expect(
		assessExpertValidationObservation(
			report(),
			{ ...reference, contractId: StrKey.encodeContract(Buffer.alloc(32, 2)) },
			policy
		)
	).toBe('contract_mismatch');
	expect(
		assessExpertValidationObservation(
			report(),
			{ ...reference, wasmSha256: hash('different code') },
			policy
		)
	).toBe('code_mismatch');
});

it('keeps previous deployment evidence historical across upgrades, even when a digest returns', () => {
	const value = report();
	const upgraded = {
		...reference,
		instanceModifiedLedger: 115,
		wasmSha256: hash('upgraded code')
	};
	expect(assessExpertValidationObservation(value, upgraded, policy)).toBe(
		'historical'
	);
	expect(
		assessExpertValidationObservation(
			value,
			{ ...upgraded, wasmSha256 },
			policy
		)
	).toBe('historical');
	expect(value.wasmSha256).toBe(wasmSha256);
	expect(
		assessExpertValidationObservation(
			report({ observedLedger: 121 }),
			reference,
			policy
		)
	).toBe('reference_behind');
});

it('uses the original reported time when available and distinguishes unavailable evidence', () => {
	expect(
		assessExpertValidationObservation(
			report({ reportedAt: '2026-11-05T14:00:00.000Z' }),
			reference,
			policy
		)
	).toBe('stale');
	expect(
		assessExpertValidationObservation(
			report({ reportedAt: null, fetchedAt: '2026-11-05T14:00:00.000Z' }),
			reference,
			policy
		)
	).toBe('stale');
	expect(
		assessExpertValidationObservation(
			report({ fetchedAt: '2026-11-05T16:10:00.000Z' }),
			reference,
			policy
		)
	).toBe('unavailable');
	expect(assessExpertValidationObservation(null, reference, policy)).toBe(
		'unavailable'
	);
	expect(assessExpertValidationObservation(report(), null, policy)).toBe(
		'unavailable'
	);
	expect(
		assessExpertValidationObservation(
			report(),
			{ ...reference, executable: 'stellar_asset', wasmSha256: null },
			policy
		)
	).toBe('unavailable');
	expect(() =>
		assessExpertValidationObservation(report(), reference, {
			...policy,
			maxAgeMs: 0
		})
	).toThrow(InvalidExpertObservation);
});

it.each([
	'http://github.com/Example/Contract',
	'https://github.com.evil.invalid/Example/Contract',
	'https://github.com@evil.invalid/path',
	'https://user@github.com/Example/Contract',
	'https://github.com:443/Example/Contract',
	'https://github.com/Example/../Contract',
	'https://github.com/Example/%2e%2e/Contract',
	'https://github.com/Example/Contract?redirect=evil',
	'https://github.com/Example/Contract#fragment',
	'https://github.com/Example\\Contract',
	'https://127.0.0.1/path',
	'javascript:alert(1)'
])('rejects unsafe display-only evidence URL %s', (url) => {
	expect(() => report({ evidenceUrls: [url] })).toThrow(
		'Unsafe verification evidence link'
	);
});

it.each([
	{ version: 2 },
	{ publisher: 'Atlas' },
	{ recordId: 'x'.repeat(129) },
	{ contractId: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1)) },
	{ networkId: 'mainnet' },
	{ wasmSha256: undefined },
	{ wasmSha256: 'A'.repeat(64) },
	{ wasmSha256: { algorithm: 'sha256', digest: wasmSha256 } },
	{ fetchedAt: '2026-02-30T12:00:00.000Z' },
	{ reportedAt: '2026-11-05T17:00:00.000Z' },
	{ observedLedger: 2 ** 32 },
	{ observedLedger: 100.5 },
	{ sourceCommit: 'main' },
	{ sourceRepo: 'https://github.com/Example/Contract' },
	{ sourceRepo: undefined },
	{ sourcePath: '../source' },
	{ sourcePath: 'C:source' },
	{ package: 'bad package' },
	{ claimedMethod: 'atlas_rebuild' },
	{ claimedSigner: 'x'.repeat(257) },
	{ providerStatus: '<script>' },
	{ evidenceUrls: Array(5).fill('https://github.com/Example/Contract') },
	{ evidenceUrls: ['https://github.com/' + 'x'.repeat(513)] },
	{ build: { status: 'verified' } },
	{ securityAudit: 'passed' }
])('rejects malformed, oversized or unsupported fields %#', (patch) => {
	expect(() => report(patch)).toThrow(InvalidExpertObservation);
});

it('hashes the same private bytes it decodes when shared input changes', () => {
	const original = encode({ ...envelope, providerStatus: 'AAAA' });
	const changed = encode({ ...envelope, providerStatus: 'BBBB' });
	const input = new Uint8Array(
		new SharedArrayBuffer(original.byteLength + 2),
		1,
		original.byteLength
	);
	input.set(original);
	const decode = TextDecoder.prototype.decode;
	const spy = jest
		.spyOn(TextDecoder.prototype, 'decode')
		.mockImplementationOnce(function (this: TextDecoder, bytes, options) {
			const decoded = decode.call(this, bytes, options);
			input.set(changed);
			return decoded;
		});
	try {
		const parsed = parseExpertValidationObservation(input);
		expect(parsed.providerStatus).toBe('AAAA');
		expect(hash(input)).toBe(hash(changed));
		expect(parsed.envelopeSha256).toBe(hash(original));
	} finally {
		spy.mockRestore();
	}
});

it('bounds raw bytes, requires valid UTF-8 JSON, and rejects ambiguous keys', () => {
	expect(() =>
		parseExpertValidationObservation(
			Buffer.alloc(MAX_EXTERNAL_VERIFICATION_BYTES + 1)
		)
	).toThrow('byte length');
	expect(() => parseExpertValidationObservation(Buffer.from([0xff]))).toThrow(
		'valid UTF-8 JSON'
	);
	expect(() => parseExpertValidationObservation(Buffer.from('{'))).toThrow(
		'valid UTF-8 JSON'
	);
	expect(() => parseExpertValidationObservation(encode([]))).toThrow(
		'Invalid verification observation envelope'
	);
	expect(() =>
		parseExpertValidationObservation(
			Buffer.from(
				JSON.stringify(envelope).slice(0, -1) + ',"wasm\\u0053ha256":null}'
			)
		)
	).toThrow('Unknown or repeated verification observation field');
	expect(
		report({ providerStatus: 'observed: "example" note' }).providerStatus
	).toBe('observed: "example" note');
});

it('keeps omitted source and signing details unknown', () => {
	expect(
		report({
			sourceRepo: undefined,
			sourceCommit: undefined,
			package: undefined,
			sourcePath: undefined,
			claimedMethod: undefined,
			claimedSigner: undefined,
			evidenceUrls: undefined
		})
	).toMatchObject({
		repository: null,
		commit: null,
		package: null,
		sourcePath: null,
		claimedMethod: null,
		claimedSigner: null,
		evidenceUrls: []
	});
});

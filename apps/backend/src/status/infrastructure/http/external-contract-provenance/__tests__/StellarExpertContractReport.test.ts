import { createHash } from 'node:crypto';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import {
	assessExpertValidationObservation,
	InvalidExpertObservation
} from '../ExpertValidationObservation.js';
import { mapStellarExpertContractReport } from '../StellarExpertContractReport.js';

const contractId = StrKey.encodeContract(Buffer.alloc(32, 7));
const code = 'a'.repeat(64);
const commit = 'b'.repeat(40);
const fetchedAt = '2026-11-05T16:00:00.000Z';
const url = (network: string) =>
	`https://api.stellar.expert/explorer/${network}/contract/${contractId}`;
const capture = { requestUrl: url('public'), fetchedAt };
const validation = {
	status: 'verified',
	ts: Date.parse('2026-11-05T15:55:00.000Z') / 1000,
	repository: 'https://github.com/Synthetic/Contract',
	commit
};
const detail = {
	contract: contractId,
	created: validation.ts - 600,
	creator: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 8)),
	wasm: code,
	versions: 2,
	validation
};
const networkId = (passphrase: string) =>
	createHash('sha256').update(passphrase).digest('hex');

it('maps the documented identity, attribution, immutable source and UNIX validation time', () => {
	const report = mapStellarExpertContractReport(detail, capture);
	expect(report).toMatchObject({
		kind: 'external_report',
		source: 'stellar-expert/verification',
		publisher: 'StellarExpert',
		recordId: `public:${contractId}`,
		networkId: networkId(Networks.PUBLIC),
		contractId,
		fetchedAt,
		reportedAt: '2026-11-05T15:55:00.000Z',
		providerStatus: 'verified',
		repository: 'Synthetic/Contract',
		commit,
		evidenceUrls: [capture.requestUrl]
	});
	expect(report?.envelopeSha256).toMatch(/^[a-f0-9]{64}$/);
	const testnet = mapStellarExpertContractReport(detail, {
		...capture,
		requestUrl: url('testnet')
	});
	expect(testnet).toMatchObject({
		recordId: `testnet:${contractId}`,
		networkId: networkId(Networks.TESTNET)
	});
	expect(testnet?.envelopeSha256).not.toBe(report?.envelopeSha256);
});

it('leaves an upstream verified report unbound despite adjacent and undocumented digests', () => {
	const report = mapStellarExpertContractReport(
		{
			...detail,
			validation: {
				...validation,
				contractHash: code,
				wasmSha256: code,
				package: 'example'
			}
		},
		capture
	);
	expect(report).toMatchObject({
		wasmSha256: null,
		observedLedger: null,
		claimedMethod: null,
		claimedSigner: null,
		package: null
	});
	expect(
		assessExpertValidationObservation(
			report,
			{
				contractId,
				networkPassphrase: Networks.PUBLIC,
				observedLedger: 20,
				instanceModifiedLedger: 10,
				executable: 'wasm',
				wasmSha256: code
			},
			{ asOf: fetchedAt, maxAgeMs: 60_000 }
		)
	).toBe('unbound');
});

it('distinguishes absent and unverified reports without inventing a source commit', () => {
	expect(
		mapStellarExpertContractReport(
			{ ...detail, validation: undefined },
			capture
		)
	).toBeNull();
	expect(
		mapStellarExpertContractReport(
			{ ...detail, validation: { status: 'unverified' } },
			capture
		)
	).toMatchObject({
		kind: 'external_report',
		providerStatus: 'unverified',
		commit: null,
		repository: null,
		reportedAt: null
	});
});

it.each([
	url('mainnet'),
	url('public') + '?address=' + contractId,
	url('public').replace('api.stellar.expert', 'api.stellar.expert.example'),
	url('public').replace('api.stellar.expert', 'api.stellar.expert:443'),
	url('public').replace(contractId, 'C' + 'A'.repeat(55)),
	url('public') + '\n'
])('rejects a noncanonical or unsupported capture URL %#', (requestUrl) => {
	expect(() =>
		mapStellarExpertContractReport(detail, { ...capture, requestUrl })
	).toThrow(InvalidExpertObservation);
});

it('rejects missing or mismatching response identity', () => {
	expect(() =>
		mapStellarExpertContractReport({ address: contractId, validation }, capture)
	).toThrow('contract identity mismatch');
	expect(() =>
		mapStellarExpertContractReport(
			{ ...detail, contract: StrKey.encodeContract(Buffer.alloc(32, 9)) },
			capture
		)
	).toThrow('contract identity mismatch');
});

it.each([
	{ status: 'authenticated' },
	{ ts: '1793894100' },
	{ ts: 1.25 },
	{ ts: Number.MAX_SAFE_INTEGER },
	{ repository: 'https://github.com.example/Synthetic/Contract' },
	{ repository: 'https://github.com/Synthetic/Contract?ref=main' },
	{ repository: 'https://github.com/' + 'a'.repeat(160) },
	{ commit: 'main' },
	{ commit: 'x'.repeat(40) },
	{ repository: undefined }
])('rejects invalid documented validation fields %#', (patch) => {
	expect(() =>
		mapStellarExpertContractReport(
			{ ...detail, validation: { ...validation, ...patch } },
			capture
		)
	).toThrow(InvalidExpertObservation);
});

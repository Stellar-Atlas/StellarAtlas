import { createHash } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import type { Request, Response } from 'express';
import { projectCatalogueItem } from '../ContractCatalogue.js';
import type { ContractProvenance } from '../ContractProvenanceService.js';

// Synthetic trust/RPC/transport inputs exercise existing binding code, not real
// Sigstore cryptography, a network observation or an independent source rebuild.
const commit = 'b'.repeat(40);
const signer =
	'https://github.com/example/contract/.github/workflows/release.yml@refs/tags/v1';
const verify = jest.fn<Promise<unknown>, unknown[]>();
const readContractCode = jest.fn<Promise<unknown>, unknown[]>();
const fetchRpcJson = jest.fn<Promise<unknown>, unknown[]>();
const fetchGithubAttestations = jest.fn<Promise<unknown>, unknown[]>();
// Use this module's Jest context so relative mocks resolve beside this test.
// @types/jest does not declare import.meta.jest's ESM mocking API.
const moduleJest = (
	import.meta as ImportMeta & {
		jest: {
			unstable_mockModule(
				name: string,
				factory: () => Record<string, unknown>
			): unknown;
		};
	}
).jest;
const mockModule = (name: string, factory: () => Record<string, unknown>) =>
	moduleJest.unstable_mockModule(name, factory);
mockModule('sigstore', () => ({
	verify,
	TUFError: class extends Error {}
}));
mockModule('../ContractRpcCode.js', () => ({
	readContractCode,
	ContractRpcUnavailable: class extends Error {}
}));
mockModule('../BoundedProvenanceJson.js', () => ({
	fetchRpcJson,
	fetchGithubAttestations,
	ProvenanceHttpError: class extends Error {}
}));
const { contractProvenanceRouter } =
	await import('../ContractProvenanceRouter');
const { ContractProvenanceService } =
	await import('../ContractProvenanceService');

function xdrString(value: string): Buffer {
	const bytes = Buffer.from(value),
		length = Buffer.alloc(4);
	length.writeUInt32BE(bytes.length);
	return Buffer.concat([
		length,
		bytes,
		Buffer.alloc((4 - (bytes.length % 4)) % 4)
	]);
}
const name = Buffer.from('contractmetav0');
const section = Buffer.concat([
	Buffer.from([name.length]),
	name,
	Buffer.alloc(4),
	xdrString('source_repo'),
	xdrString('github:example/contract')
]);
const wasm = Buffer.concat([
	Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, section.length]),
	section
]);
const hash = createHash('sha256').update(wasm).digest('hex');
const contractId = StrKey.encodeContract(new Uint8Array(32).fill(7));
function bundle(subjectHash = hash) {
	return {
		mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
		verificationMaterial: {},
		dsseEnvelope: {
			payloadType: 'application/vnd.in-toto+json',
			payload: Buffer.from(
				JSON.stringify({
					_type: 'https://in-toto.io/Statement/v1',
					predicateType: 'https://slsa.dev/provenance/v1',
					subject: [{ digest: { sha256: subjectHash } }],
					predicate: {
						buildDefinition: {
							buildType: 'https://actions.github.io/buildtypes/workflow/v1',
							resolvedDependencies: [
								{
									uri: 'git+https://github.com/example/contract@refs/tags/v1',
									digest: { gitCommit: commit }
								}
							],
							externalParameters: {
								workflow: {
									repository: 'https://github.com/example/contract',
									path: '.github/workflows/release.yml',
									ref: 'refs/tags/v1'
								}
							}
						},
						runDetails: {
							metadata: {
								invocationId:
									'https://github.com/example/contract/actions/runs/1'
							}
						}
					}
				})
			).toString('base64')
		}
	};
}
async function invoke(
	id = contractId,
	observe?: (value: ContractProvenance) => Promise<void>
) {
	const router = contractProvenanceRouter({
		rpcUrl: 'https://rpc.invalid',
		approvedNativeRpcUrl: 'https://rpc.invalid',
		networkPassphrase: 'synthetic network',
		observe
	});
	const layer = router.stack.find(
		(value) => value.route?.path === '/contracts/:contractId/provenance'
	);
	if (!layer?.route)
		throw new Error('Actual registered provenance route missing');
	let status = 200,
		body: unknown;
	const headers = new Map<string, string>();
	const response = {
		status(value: number) {
			status = value;
			return this;
		},
		setHeader(key: string, value: string) {
			headers.set(key.toLowerCase(), value);
			return this;
		},
		json(value: unknown) {
			body = value;
			return this;
		}
	};
	const handler = layer.route.stack[0]!.handle as (
		request: Request,
		response: Response
	) => Promise<void>;
	await handler(
		{ params: { contractId: id } } as unknown as Request,
		response as unknown as Response
	);
	return { status, body, headers };
}
beforeEach(() => {
	verify
		.mockReset()
		.mockResolvedValue({ identity: { subjectAlternativeName: signer } });
	readContractCode.mockReset().mockResolvedValue({
		ledger: 150,
		modifiedLedger: 100,
		executable: 'wasm',
		wasmSha256: hash,
		wasm
	});
	fetchRpcJson.mockReset();
	fetchGithubAttestations
		.mockReset()
		.mockResolvedValue({ attestations: [{ bundle: bundle() }] });
});
describe('synthetic registered provenance journey', () => {
	it('preserves native verification without projecting configured network text as evidence', async () => {
		const observe = jest.fn(async (_value: ContractProvenance) => undefined);
		const result = await invoke(contractId, observe);
		expect(result.status).toBe(200);
		expect(result.body).toMatchObject({
			networkPassphrase: 'synthetic network',
			build: { status: 'verified' }
		});
		expect(projectCatalogueItem(result.body as ContractProvenance)).toBeNull();
		expect(observe).not.toHaveBeenCalled();
	});
	it('projects scoped evidence without holding verifier slots or queuing saturated writes', async () => {
		const writes: { resolve: () => void; reject: (error: Error) => void }[] = [];
		const observe = jest.fn((_value: ContractProvenance) =>
			new Promise<void>((resolve, reject) => writes.push({ resolve, reject }))
		);
		const scoped = {
			read: jest.fn(async (_id: string) => ({
				ledger: 150,
				modifiedLedger: 100,
				executable: 'wasm' as const,
				wasmSha256: hash,
				wasm,
				freshUntil: Date.now() + 30_000
			}))
		};
		const service = new ContractProvenanceService(
			undefined,
			'synthetic network',
			scoped,
			observe
		);
		const address = (byte: number) =>
			StrKey.encodeContract(new Uint8Array(32).fill(byte));
		const warning = jest
			.spyOn(console, 'warn')
			.mockImplementation(() => undefined);
		try {
			const first = await service.get(contractId);
			expect(projectCatalogueItem(first)).toEqual({
				contractId,
				observedLedger: 150,
				instanceModifiedLedger: 100,
				checkedAt: expect.any(String),
				wasmSha256: hash,
				ledgerEvidence: 'configured_rpc_observation',
				build: { status: 'verified', record: first.build.record },
				independentReproduction: 'not_assessed', securityAudit: 'not_assessed'
			});
			for (const byte of [8, 9]) {
				await expect(service.get(address(byte))).resolves.toMatchObject({
					build: { status: 'verified' }
				});
			}
			await expect(service.get(contractId)).resolves.toBe(first);
			expect(scoped.read).toHaveBeenCalledTimes(3);
			expect(observe).toHaveBeenCalledTimes(2);
			writes[0]!.reject(new Error('Synthetic database failure'));
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(warning).toHaveBeenCalledTimes(1);
			expect(observe).toHaveBeenCalledTimes(2);
			await service.get(address(10));
			expect(observe.mock.calls.map(([value]) => value.contractId)).toEqual(
				[contractId, address(8), address(10)]
			);
		} finally {
			for (const write of writes) write.resolve();
			warning.mockRestore();
		}
	});
	it('returns the exact observed hash/commit from actual metadata and attestation binding', async () => {
		const result = await invoke();
		expect(result.status).toBe(200);
		expect(result.body).toMatchObject({
			contractId,
			observedLedger: 150,
			wasmSha256: hash,
			securityAudit: 'not_assessed',
			build: {
				status: 'verified',
				record: {
					commit,
					sourceUrl: 'https://github.com/example/contract/tree/' + commit
				}
			}
		});
		expect(verify).toHaveBeenCalledTimes(1);
		expect(verify.mock.calls[0]![1]).toMatchObject({
			certificateIssuer: 'https://token.actions.githubusercontent.com',
			certificateOIDs: { '1.3.6.1.4.1.57264.1.3': commit },
			retry: { retries: 0 }
		});
		expect(fetchGithubAttestations).toHaveBeenCalledWith(
			'example/contract',
			hash
		);
	});
	it('returns HTTP200 invalid for artifact mismatch without accepting injected signature trust', async () => {
		fetchGithubAttestations.mockResolvedValue({
			attestations: [{ bundle: bundle('c'.repeat(64)) }]
		});
		const result = await invoke();
		expect(result.status).toBe(200);
		expect(result.body).toMatchObject({
			wasmSha256: hash,
			build: { status: 'invalid', record: null }
		});
		expect(verify).not.toHaveBeenCalled();
	});
	it('rejects copied source metadata, predicate and Wasm digest signed by another caller', async () => {
		// The attacker's repository called the approved reusable signer but reused
		// the victim's exact Wasm/metadata and claimed the victim in the statement.
		verify.mockResolvedValue({
			identity: {
				subjectAlternativeName:
					'https://github.com/stellar-expert/soroban-build-workflow/.github/workflows/release.yml@refs/heads/main',
				oids: [
					[
						9,
						'https://github.com/stellar-expert/soroban-build-workflow/.github/workflows/release.yml@refs/heads/main'
					],
					[10, 'fbd0e2c5bbcbcd22439c06b5f1da47e2b27672d4'],
					[12, 'https://github.com/attacker/contract'],
					[13, commit],
					[14, 'refs/tags/v1'],
					[
						18,
						'https://github.com/attacker/contract/.github/workflows/release.yml@refs/tags/v1'
					],
					[19, commit]
				].map(([number, value]) => {
					const bytes = Buffer.from(String(value));
					return {
						oid: { id: [1, 3, 6, 1, 4, 1, 57264, 1, number] },
						value: Buffer.concat([Buffer.from([0x0c, bytes.length]), bytes])
					};
				})
			}
		});
		const result = await invoke();
		expect(result.status).toBe(200);
		expect(result.body).toMatchObject({
			metadata: { sourceRepository: 'example/contract' },
			wasmSha256: hash,
			build: { status: 'invalid', record: null }
		});
		expect(verify).toHaveBeenCalledTimes(1);
	});
	it('does not reuse cached evidence across repositories for the same digest', async () => {
		const service = new ContractProvenanceService(
			undefined,
			'synthetic network'
		);
		// Identical Wasm cannot embed two different source_repo values. Exercise
		// the build-evidence cache boundary directly instead of faking that state.
		const check = (repo: string) => service['build'](repo, hash);
		await expect(check('example/contract')).resolves.toMatchObject({
			status: 'verified',
			record: { repository: 'example/contract' }
		});
		await expect(check('attacker/contract')).resolves.toEqual({
			status: 'invalid',
			record: null
		});
		await expect(check('example/contract')).resolves.toMatchObject({
			status: 'verified'
		});
		expect(fetchGithubAttestations.mock.calls).toEqual([
			['example/contract', hash],
			['attacker/contract', hash]
		]);
		expect(verify).toHaveBeenCalledTimes(1);
	});
	it('keeps unpublished and external evidence failure as unresolved HTTP200 results', async () => {
		for (const status of ['not_published', 'unavailable']) {
			if (status === 'not_published')
				fetchGithubAttestations.mockResolvedValue({ attestations: [] });
			else
				fetchGithubAttestations.mockRejectedValue(
					new Error('Synthetic upstream failure')
				);
			const result = await invoke();
			expect(result.status).toBe(200);
			expect(result.body).toMatchObject({ build: { status, record: null } });
		}
	});
	it('distinguishes invalid address400 and RPC failure503 from unresolved build status', async () => {
		const invalid = await invoke('not-a-contract');
		expect(invalid.status).toBe(400);
		expect(invalid.body).toMatchObject({ code: 'invalid_contract' });
		expect(readContractCode).not.toHaveBeenCalled();
		readContractCode.mockRejectedValue(new Error('Synthetic RPC failure'));
		const failed = await invoke();
		expect(failed.status).toBe(503);
		expect(failed.body).toMatchObject({
			code: 'contract_evidence_unavailable'
		});
		expect(failed.headers.get('cache-control')).toBe('no-store');
		expect(failed.headers.get('retry-after')).toBe('30');
	});
});

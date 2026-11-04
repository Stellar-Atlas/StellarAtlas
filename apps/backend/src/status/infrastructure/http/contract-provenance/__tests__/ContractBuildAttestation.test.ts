import {
	githubRepository,
	verifyContractBuildAttestation
} from '../ContractBuildAttestation';

const repository = 'example/contract';
const hash = 'a'.repeat(64);
const commit = 'b'.repeat(40);
const ref = 'refs/tags/v1';
const workflowPath = '.github/workflows/release.yml';
const workflowIdentity = (
	repo: string,
	workflowRef = ref,
	path = workflowPath
) => 'https://github.com/' + repo + '/' + path + '@' + workflowRef;
const identity = workflowIdentity(repository);
function bundle(
	subjectHash = hash,
	repo = repository,
	workflowRef = ref,
	runUrl?: string,
	path = workflowPath
) {
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
						runDetails: { metadata: { invocationId: runUrl } },
						buildDefinition: {
							buildType: 'https://actions.github.io/buildtypes/workflow/v1',
							resolvedDependencies: [
								{
									uri: 'git+https://github.com/' + repo + '@' + workflowRef,
									digest: { gitCommit: commit }
								}
							],
							externalParameters: {
								workflow: {
									repository: 'https://github.com/' + repo,
									path,
									ref: workflowRef
								}
							}
						}
					}
				})
			).toString('base64')
		}
	};
}

describe('contract build provenance binding', () => {
	it('binds the signature to the exact workflow, repository, commit and artifact', async () => {
		const verifySignature = jest
			.fn()
			.mockResolvedValue({ identity: { subjectAlternativeName: identity } });
		const result = await verifyContractBuildAttestation(
			bundle(),
			repository,
			hash,
			verifySignature
		);
		expect(result.commit).toBe(commit);
		expect(result.sourceUrl).toBe(
			'https://github.com/example/contract/tree/' + commit
		);
		expect(verifySignature.mock.calls[0]![1]).toMatchObject({
			certificateIssuer: 'https://token.actions.githubusercontent.com',
			certificateOIDs: { '1.3.6.1.4.1.57264.1.3': commit },
			ctLogThreshold: 1,
			tlogThreshold: 1
		});
	});
	it('rejects a different artifact, repository, signer, or failed signature', async () => {
		const signature = jest
			.fn()
			.mockResolvedValue({ identity: { subjectAlternativeName: identity } });
		await expect(
			verifyContractBuildAttestation(
				bundle('c'.repeat(64)),
				repository,
				hash,
				signature
			)
		).rejects.toThrow('subject');
		await expect(
			verifyContractBuildAttestation(
				bundle(),
				'attacker/contract',
				hash,
				signature
			)
		).rejects.toThrow('commit');
		await expect(
			verifyContractBuildAttestation(bundle(), repository, hash, async () => ({
				identity: { subjectAlternativeName: identity + '-spoof' }
			}))
		).rejects.toThrow('signer');
		await expect(
			verifyContractBuildAttestation(bundle(), repository, hash, async () => {
				throw new Error('Bad signature');
			})
		).rejects.toThrow('Bad signature');
	});
	it('allows only fixed GitHub repository identities, never arbitrary metadata URLs', () => {
		expect(githubRepository('github:example/contract')).toBe(repository);
		for (const input of [
			'https://evil.test',
			'github:example/../secret',
			'github:user/repo?x=1',
			'github:user/repo@branch'
		])
			expect(githubRepository(input)).toBeNull();
	});
});

describe('authenticated reusable release workflow binding', () => {
	const caller = 'reflector-network/reflector-dao-contract';
	const signerRepo = 'stellar-expert/soroban-build-workflow';
	const signerRef = 'refs/heads/main';
	const signer = workflowIdentity(signerRepo, signerRef);
	const callerClaims = (
		repo: string,
		workflowRef = ref,
		path = workflowPath
	): Record<number, string> => ({
		9: signer,
		10: 'fbd0e2c5bbcbcd22439c06b5f1da47e2b27672d4',
		12: 'https://github.com/' + repo,
		13: commit,
		14: workflowRef,
		18: workflowIdentity(repo, workflowRef, path),
		19: commit
	});
	const claims = callerClaims(caller);
	const oid = (number: number, value: string) => ({
		oid: { id: [1, 3, 6, 1, 4, 1, 57264, 1, number] },
		value: Buffer.concat([
			Buffer.from([0x0c, Buffer.byteLength(value)]),
			Buffer.from(value)
		])
	});
	const signature = (subjectAlternativeName = signer, fields = claims) =>
		jest.fn().mockResolvedValue({
			identity: {
				subjectAlternativeName,
				oids: Object.entries(fields).map(([number, value]) =>
					oid(Number(number), value)
				)
			}
		});

	it('requires one verification with the same issuer, commit and transparency policy', async () => {
		const verify = signature();
		await expect(
			verifyContractBuildAttestation(bundle(hash, caller), caller, hash, verify)
		).resolves.toMatchObject({ repository: caller, commit });
		expect(verify).toHaveBeenCalledTimes(1);
		const options = verify.mock.calls[0]![1];
		expect(options).toMatchObject({
			certificateIssuer: 'https://token.actions.githubusercontent.com',
			certificateOIDs: { '1.3.6.1.4.1.57264.1.3': commit },
			ctLogThreshold: 1,
			tlogThreshold: 1
		});
		const allowed = new RegExp(options.certificateIdentityURI);
		expect(allowed.test(signer)).toBe(true);
		expect(allowed.test(workflowIdentity(caller))).toBe(true);
		expect(allowed.test(signer + '-spoof')).toBe(false);
	});

	it('verifies a second caller with its own workflow path and branch claims', async () => {
		const second = 'example/another-contract';
		const secondRef = 'refs/heads/stable';
		const secondPath = '.github/workflows/publish.yaml';
		await expect(
			verifyContractBuildAttestation(
				bundle(hash, second, secondRef, undefined, secondPath),
				second,
				hash,
				signature(signer, callerClaims(second, secondRef, secondPath))
			)
		).resolves.toMatchObject({
			repository: second,
			commit,
			workflowUrl:
				'https://github.com/' + second + '/blob/' + commit + '/' + secondPath
		});
	});

	it.each<[number, string]>([
		[9, workflowIdentity('attacker/build', signerRef)],
		[10, 'c'.repeat(40)],
		[12, 'https://github.com/attacker/contract'],
		[13, 'c'.repeat(40)],
		[14, 'refs/heads/unrelated'],
		[18, workflowIdentity('attacker/contract')],
		[18, workflowIdentity(caller, ref, '.github/workflows/unrelated.yml')],
		[19, 'c'.repeat(40)]
	])('rejects a wrong authenticated claim (%s)', async (number, value) => {
		await expect(
			verifyContractBuildAttestation(
				bundle(hash, caller),
				caller,
				hash,
				signature(signer, { ...claims, [number]: value })
			)
		).rejects.toThrow('required claim ' + number);
	});

	it('rejects missing, malformed and ambiguous authenticated claims', async () => {
		const missing = { ...claims };
		delete missing[18];
		await expect(
			verifyContractBuildAttestation(
				bundle(hash, caller),
				caller,
				hash,
				signature(signer, missing)
			)
		).rejects.toThrow('required claim 18');
		const verify = signature();
		const authenticated = await verify();
		authenticated.identity.oids.push(oid(18, claims[18]!));
		await expect(
			verifyContractBuildAttestation(bundle(hash, caller), caller, hash, verify)
		).rejects.toThrow('required claim 18');
		const malformed = signature();
		const claim = (await malformed()).identity.oids.find(
			({ oid: { id } }: ReturnType<typeof oid>) => id.at(-1) === 18
		);
		claim.value = Buffer.from(claims[18]!);
		await expect(
			verifyContractBuildAttestation(
				bundle(hash, caller),
				caller,
				hash,
				malformed
			)
		).rejects.toThrow('required claim 18');
	});

	it('reports a reusable workflow run only when the certificate binds it', async () => {
		const runUrl =
			'https://github.com/' + caller + '/actions/runs/123/attempts/1';
		const input = bundle(hash, caller, ref, runUrl);
		await expect(
			verifyContractBuildAttestation(
				input,
				caller,
				hash,
				signature(signer, { ...claims, 21: runUrl })
			)
		).resolves.toMatchObject({ runUrl });
		await expect(
			verifyContractBuildAttestation(
				input,
				caller,
				hash,
				signature(signer, { ...claims, 21: runUrl + '2' })
			)
		).rejects.toThrow('required claim 21');
	});

	it('rejects certificate replay for another repository, unknown signers, and the wrong artifact', async () => {
		await expect(
			verifyContractBuildAttestation(bundle(), repository, hash, signature())
		).rejects.toThrow('required claim 12');
		await expect(
			verifyContractBuildAttestation(
				bundle(hash, caller),
				caller,
				hash,
				signature(signer + '-spoof')
			)
		).rejects.toThrow('signer');
		const verify = signature();
		await expect(
			verifyContractBuildAttestation(
				bundle('c'.repeat(64), caller),
				caller,
				hash,
				verify
			)
		).rejects.toThrow('subject');
		expect(verify).not.toHaveBeenCalled();
	});

	it('keeps direct verification when the reusable signer repository builds for itself', async () => {
		const input = bundle(hash, signerRepo, signerRef);
		await expect(
			verifyContractBuildAttestation(
				input,
				signerRepo,
				hash,
				signature(signer, {
					...callerClaims(signerRepo, signerRef),
					10: commit
				})
			)
		).resolves.toMatchObject({ repository: signerRepo, commit });
		await expect(
			verifyContractBuildAttestation(input, signerRepo, hash, signature())
		).rejects.toThrow('required claim 10');
		await expect(
			verifyContractBuildAttestation(
				input,
				signerRepo,
				hash,
				signature(signer, { ...claims, 10: commit })
			)
		).rejects.toThrow('required claim 12');
	});
});

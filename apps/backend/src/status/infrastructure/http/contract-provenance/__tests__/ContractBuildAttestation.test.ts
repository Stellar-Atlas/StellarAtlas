import {
	githubRepository,
	verifyContractBuildAttestation
} from '../ContractBuildAttestation';

const repository = 'example/contract';
const hash = 'a'.repeat(64);
const commit = 'b'.repeat(40);
const identity =
	'https://github.com/example/contract/.github/workflows/release.yml@refs/tags/v1';
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

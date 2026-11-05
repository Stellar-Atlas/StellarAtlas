import { api, Code, type DeveloperGuidePage } from './developer-guide-elements';
import { contractReproductionSection } from './developer-guide-contract-reproduction';

const reflectorContract =
	'CBQSUF57OYX4RIMCZV62DKN6JFOTEKPHIZASMJYOUOCNHGNG2P3XQLSE';
const reflectorDigest =
	'f60d33ec57eecee04b52d048c1c079983ff1b3834c8195fea811b025fb889361';
const reflectorCommit = 'ac9740f12a50a81c1b96d1e8d929a6066d2d00a8';
const reflectorRepo = 'https://github.com/reflector-network/reflector-dao-contract';

const outcomes = [
	[
		'verified',
		'The signed build binds to this Wasm, repository, commit and workflow. Inspect build.record links.'
	],
	[
		'invalid',
		'An available attestation failed a binding or verification check. Check the artifact digest, source commit, workflow and signature; no detailed mismatch reason is returned.'
	],
	[
		'not_published',
		'No attestation was found for this repository and digest. Publish the matching artifact attestation, then allow cached results to expire.'
	],
	[
		'metadata_missing',
		'The Wasm has no source_repo entry. Include supported metadata in a future build; changing the bytes changes the digest.'
	],
	[
		'metadata_invalid',
		'Wasm metadata could not be read or validated. Check its encoding, repeated entries and artifact hash.'
	],
	[
		'unsupported',
		'The repository metadata or attestation format is unsupported. Use the supported GitHub repository and workflow provenance format.'
	],
	[
		'unavailable',
		'Build evidence or trust material could not be checked. Treat verification as unresolved; retry later with backoff.'
	],
	[
		'builtin',
		'This is a built-in Stellar asset contract, with no Wasm build to attest.'
	],
	[
		'not_found_at_ledger',
		'The contract instance was not found at observedLedger. Check the address and RPC coverage; this does not mean it was never deployed.'
	]
] as const;

export const contractVerificationGuide: DeveloperGuidePage = {
	slug: 'contract-verification',
	title: 'Contract build verification',
	group: 'Reference',
	description:
		'Publish discoverable build provenance, inspect deployed code and interpret verification results.',
	sections: [
		{
			id: 'lookup-provenance',
			title: '1. Inspect a deployed contract',
			content: (
				<>
					<p>
						Use a contract C-address with the{' '}
						<a href="/docs/api/getContractBuildProvenance">
							provenance endpoint
						</a>
						. This checks signed build provenance. Use the Reflector DAO
						Mainnet contract below as a reference with a published attestation.
					</p>
					<Code>{`curl -q --include --fail-with-body --connect-timeout 5 --max-time 60 \\
  '${api}/v1/contracts/${reflectorContract}/provenance'`}</Code>
					<p>
						The{' '}
						<a href={`${reflectorRepo}/releases/tag/v1.1.0_reflector-dao-contract_cli22.0.1`}>
							Reflector DAO v1.1.0 release
						</a>{' '}
						has Wasm SHA-256 <code>{reflectorDigest}</code> and an attestation
						for <a href={`${reflectorRepo}/tree/${reflectorCommit}`}>source commit {reflectorCommit}</a>.
						Compare the response’s <code>wasmSha256</code> before using that
						reference. For the same digest, a verified result should name that
						commit in <code>build.record.commit</code>. The contract can be
						upgraded and the lookup can return an unresolved result.
					</p>
					<p>
						Replace the address with your contract. Save{' '}
						<code>networkPassphrase</code>, <code>observedLedger</code>,{' '}
						<code>checkedAt</code>, <code>wasmSha256</code>,{' '}
						<code>build.status</code> and <code>ledgerEvidence</code> (if present)
						together. The observed ledger may not be the current network head.
						An upgrade can change the executable and digest.
					</p>
					<p>
						<code>ledgerEvidence</code> set to{' '}
						<code>configured_rpc_observation</code> identifies a configured RPC
						observation, not an independent ledger-state proof. Native responses
						may omit this field. An absent or unrecognized value does not
						establish independent proof. Read <code>build.status</code> separately
						for the attestation outcome.
					</p>
				</>
			)
		},
		{
			id: 'publish-build',
			title: '2. Make a build discoverable',
			content: (
				<>
					<p>
						For builders, the supported publication path is a GitHub artifact
						attestation in a publicly readable repository. There is no Atlas
						source-upload or verification-job submission endpoint. The lookup
						discovers published evidence for the exact deployed Wasm digest.
					</p>
					<ol>
						<li>
							Embed <code>source_repo=github:YOUR_ORG/YOUR_REPO</code> in the
							Wasm metadata before building the artifact you deploy. This
							checker accepts that repository form, without a branch or commit
							suffix. See the{' '}
							<a href="https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0046.md">
								contract metadata specification
							</a>
							.
							<Code>{`stellar contract build --meta source_repo=github:YOUR_ORG/YOUR_REPO`}</Code>
						</li>
						<li>
							Use the repository’s GitHub Actions build to{' '}
							<a href="https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations">
								publish artifact provenance
							</a>{' '}
							for the final Wasm bytes, including any optimization and metadata.
							The subject SHA-256 must equal the observed deployed digest;
							attesting a source archive or a different build is insufficient.
						</li>
						<li>
							The supported bundle uses in-toto Statement v1, SLSA provenance v1
							and GitHub workflow build provenance. Repository, source commit,
							workflow identity, certificate and transparency evidence must
							match. The source commit comes from verified provenance, not a
							metadata claim alone.
						</li>
						<li>
							After publication, repeat the lookup and inspect the returned
							status. Native contract observations can be retained for one minute,
							and build outcomes for up to thirty minutes.
							Repeated requests do not force a fresh build check.
						</li>
					</ol>
				</>
			)
		},
		{
			id: 'verification-results',
			title: '3. Handle verified and unresolved results',
			content: (
				<>
					<p>
						HTTP 200 means an evidence response was returned. Read{' '}
						<code>build.status</code> before displaying a verification badge.
						The API has no separate <code>mismatch</code> or{' '}
						<code>unverified</code> status; preserve the specific result below.
					</p>
					<table>
						<thead>
							<tr>
								<th>build.status</th>
								<th>Meaning and next action</th>
							</tr>
						</thead>
						<tbody>
							{outcomes.map(([status, meaning]) => (
								<tr key={status}>
									<td>
										<code>{status}</code>
									</td>
									<td>{meaning}</td>
								</tr>
							))}
						</tbody>
					</table>
					<p>
						HTTP 400 with <code>invalid_contract</code> requires a valid
						C-address. HTTP 503 with <code>verification_busy</code> or{' '}
						<code>contract_evidence_unavailable</code> is a request failure;
						honor <code>Retry-After</code> before a deliberate retry. It is
						different from a successful response containing{' '}
						<code>build.status=unavailable</code>. A client timeout is also
						unresolved, not evidence of an invalid contract.
					</p>
				</>
			)
		},
		{
			id: 'verification-boundaries',
			title: '4. Keep the trust boundaries visible',
			content: (
				<>
					<p>
						For <code>verified</code>, follow{' '}
						<code>build.record.sourceUrl</code> to the exact commit and{' '}
						<code>workflowUrl</code> to its build workflow. <code>runUrl</code>{' '}
						can be null; <code>attestationUrl</code> locates the repository’s
						evidence for the digest. Other build outcomes have a null record.
						Embedded repository and home-domain metadata remain
						developer-supplied claims.
					</p>
					<p>
						<strong>Build attested</strong> means the provenance check accepted
						the signed build for the observed Wasm. For a source-to-Wasm match,
						rebuild with pinned inputs and compare the complete output bytes.
						The <a href="#offline-reproduction">offline recipe below</a> uses
						a separate historical fixture. Contract safety and ledger-state
						inclusion require separate evidence. <code>securityAudit</code> remains{' '}
						<code>not_assessed</code>.
					</p>
				</>
			)
		},
		contractReproductionSection
	]
};

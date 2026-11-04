import type { VerifyOptions, Bundle } from 'sigstore';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface ContractBuildRecord {
	readonly repository: string;
	readonly commit: string;
	readonly sourceUrl: string;
	readonly workflowUrl: string;
	readonly runUrl: string | null;
	readonly attestationUrl: string;
}

type SignatureVerifier = (
	bundle: Bundle,
	options: VerifyOptions
) => Promise<unknown>;

export class BuildTrustUnavailable extends Error {}
export class UnsupportedBuildAttestation extends Error {}

const verifySignatureDefault: SignatureVerifier = async (bundle, options) => {
	const { verify, TUFError } = await import('sigstore');
	try {
		return await verify(bundle, options);
	} catch (error) {
		if (error instanceof TUFError)
			throw new BuildTrustUnavailable('Build trust material is unavailable');
		throw error;
	}
};

export function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function githubRepository(value: string | null): string | null {
	if (!value) return null;
	const match =
		/^github:([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})$/.exec(
			value
		);
	if (!match || match[2] === '.' || match[2] === '..') return null;
	return match[1] + '/' + match[2];
}

function dependencyMatches(uri: unknown, repository: string): boolean {
	if (typeof uri !== 'string' || uri.length > 1024) return false;
	const normalized = uri
		.replace(/^git\+/, '')
		.split('@')[0]!
		.replace(/\.git$/, '')
		.replace(/\/$/, '');
	return (
		normalized.toLowerCase() ===
		'https://github.com/' + repository.toLowerCase()
	);
}

function regexEscape(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// This is the only approved reusable signer revision. The certificate must
// attribute the build to the requested repository and workflow at build time;
// it does not establish current repository ownership.
const reusableSigner =
	'https://github.com/stellar-expert/soroban-build-workflow/.github/workflows/release.yml@refs/heads/main';
const reusableSignerCommit = 'fbd0e2c5bbcbcd22439c06b5f1da47e2b27672d4';
const fulcioOid = '1.3.6.1.4.1.57264.1.';

function verifyReusableIdentity(
	certificate: Record<string, unknown>,
	repository: string,
	caller: string,
	commit: string,
	ref: string,
	runUrl: string | null
): void {
	// sigstore@5 returns the authenticated X.509 extension octets on the verified
	// signer. Fulcio encodes these modern claims as DER UTF8String, not raw text.
	const claims = Array.isArray(certificate.oids)
		? certificate.oids.map(record)
		: [];
	const expected = {
		9: reusableSigner,
		10: caller === reusableSigner ? commit : reusableSignerCommit,
		12: 'https://github.com/' + repository,
		13: commit,
		14: ref,
		18: caller,
		19: commit,
		...(runUrl === null ? {} : { 21: runUrl })
	};
	for (const [number, value] of Object.entries(expected)) {
		const oid = fulcioOid + number;
		const matches = claims.filter((claim) => {
			const id = record(claim.oid).id;
			return Array.isArray(id) && id.join('.') === oid;
		});
		const utf8 = Buffer.from(value);
		const bytes = matches[0]?.value;
		const length = utf8.length;
		// Canonical DER includes a long-form length for longer workflow identities.
		if (length > 0xffff)
			throw new Error('Reusable certificate claim is too long');
		const header =
			length < 128
				? [0x0c, length]
				: length < 256
					? [0x0c, 0x81, length]
					: [0x0c, 0x82, length >> 8, length & 0xff];
		if (
			matches.length !== 1 ||
			!Buffer.isBuffer(bytes) ||
			!bytes.equals(Buffer.concat([Buffer.from(header), utf8]))
		)
			throw new Error(
				'Reusable signer certificate does not bind required claim ' + number
			);
	}
}

export async function verifyContractBuildAttestation(
	bundle: unknown,
	repository: string,
	wasmSha256: string,
	verifySignature: SignatureVerifier = verifySignatureDefault
): Promise<ContractBuildRecord> {
	if (
		githubRepository('github:' + repository) !== repository ||
		!/^[a-f0-9]{64}$/.test(wasmSha256)
	)
		throw new Error('Invalid build verification identity');
	const parsedBundle = record(bundle);
	if (
		typeof parsedBundle.mediaType !== 'string' ||
		!parsedBundle.verificationMaterial
	)
		throw new Error('Invalid signed bundle');
	const envelope = record(parsedBundle.dsseEnvelope);
	if (
		envelope.payloadType !== 'application/vnd.in-toto+json' ||
		typeof envelope.payload !== 'string' ||
		envelope.payload.length > 256 * 1024
	)
		throw new UnsupportedBuildAttestation(
			'Unsupported build attestation envelope'
		);
	const statement = record(
		JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'))
	);
	if (
		statement._type !== 'https://in-toto.io/Statement/v1' ||
		statement.predicateType !== 'https://slsa.dev/provenance/v1'
	)
		throw new UnsupportedBuildAttestation(
			'Unsupported build attestation statement'
		);
	const subjects = Array.isArray(statement.subject) ? statement.subject : [];
	if (
		!subjects.some(
			(subject: unknown) => record(record(subject).digest).sha256 === wasmSha256
		)
	)
		throw new Error('Build subject does not match deployed Wasm');
	const predicate = record(statement.predicate);
	const definition = record(predicate.buildDefinition);
	if (
		definition.buildType !== 'https://actions.github.io/buildtypes/workflow/v1'
	)
		throw new UnsupportedBuildAttestation('Unsupported build workflow');
	const dependencies = Array.isArray(definition.resolvedDependencies)
		? definition.resolvedDependencies
		: [];
	const matching = dependencies
		.map(record)
		.filter((dependency) => dependencyMatches(dependency.uri, repository));
	const commits = new Set(
		matching.map((dependency) => record(dependency.digest).gitCommit)
	);
	const commit = [...commits][0];
	if (
		commits.size !== 1 ||
		typeof commit !== 'string' ||
		!/^[a-f0-9]{40}$/.test(commit)
	)
		throw new Error('Build source commit does not match repository');
	const workflow = record(record(definition.externalParameters).workflow);
	if (
		!dependencyMatches(workflow.repository, repository) ||
		typeof workflow.path !== 'string' ||
		!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(workflow.path) ||
		typeof workflow.ref !== 'string' ||
		!/^refs\/(heads|tags)\/[^\s@?#]{1,200}$/.test(workflow.ref)
	)
		throw new Error('Build workflow does not match repository');
	const identity =
		'https://github.com/' +
		repository +
		'/' +
		workflow.path +
		'@' +
		workflow.ref;
	const signerIdentities = new Set([identity, reusableSigner]);
	// Sigstore validates the complete untrusted bundle structure before cryptographic verification.
	const verified = record(
		await verifySignature(parsedBundle as Bundle, {
			certificateIssuer: 'https://token.actions.githubusercontent.com',
			certificateIdentityURI:
				'^(?:' + [...signerIdentities].map(regexEscape).join('|') + ')$',
			certificateOIDs: { [fulcioOid + '3']: commit },
			ctLogThreshold: 1,
			tlogThreshold: 1,
			timeout: 10_000,
			retry: { retries: 0 },
			tufCachePath: join(tmpdir(), 'stellaratlas-sigstore')
		})
	);
	const run = record(record(predicate.runDetails).metadata).invocationId;
	const runPattern = new RegExp(
		'^https://github\\.com/' +
			regexEscape(repository) +
			'/actions/runs/[0-9]+(?:/attempts/[0-9]+)?$'
	);
	let runUrl = typeof run === 'string' && runPattern.test(run) ? run : null;
	const certificate = record(verified.identity);
	const verifiedSigner = certificate.subjectAlternativeName;
	if (verifiedSigner === reusableSigner) {
		// The same SAN can also be the signer's own direct release workflow.
		// Never let a reusable invocation of that workflow pass as a direct build.
		// A run link is optional. If present, require the certificate to bind it too.
		if (runUrl !== null && runUrl.length > 256) runUrl = null;
		verifyReusableIdentity(
			certificate,
			repository,
			identity,
			commit,
			workflow.ref,
			runUrl
		);
	} else if (verifiedSigner !== identity)
		throw new Error('Verified signer does not match build workflow');
	return {
		repository,
		commit,
		sourceUrl: 'https://github.com/' + repository + '/tree/' + commit,
		workflowUrl:
			'https://github.com/' +
			repository +
			'/blob/' +
			commit +
			'/' +
			workflow.path,
		runUrl,
		attestationUrl:
			'https://api.github.com/repos/' +
			repository +
			'/attestations/sha256:' +
			wasmSha256
	};
}

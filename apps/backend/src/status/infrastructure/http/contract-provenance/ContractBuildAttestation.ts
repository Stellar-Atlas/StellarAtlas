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
	// Sigstore validates the complete untrusted bundle structure before cryptographic verification.
	const verified = record(
		await verifySignature(parsedBundle as Bundle, {
			certificateIssuer: 'https://token.actions.githubusercontent.com',
			certificateIdentityURI: '^' + regexEscape(identity) + '$',
			certificateOIDs: { '1.3.6.1.4.1.57264.1.3': commit },
			ctLogThreshold: 1,
			tlogThreshold: 1,
			timeout: 10_000,
			retry: { retries: 0 },
			tufCachePath: join(tmpdir(), 'stellaratlas-sigstore')
		})
	);
	if (record(verified.identity).subjectAlternativeName !== identity)
		throw new Error('Verified signer does not match build workflow');
	const run = record(record(predicate.runDetails).metadata).invocationId;
	const runPattern = new RegExp(
		'^https://github\\.com/' +
			regexEscape(repository) +
			'/actions/runs/[0-9]+(?:/attempts/[0-9]+)?$'
	);
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
		runUrl: typeof run === 'string' && runPattern.test(run) ? run : null,
		attestationUrl:
			'https://api.github.com/repos/' +
			repository +
			'/attestations/sha256:' +
			wasmSha256
	};
}

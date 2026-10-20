import { StrKey } from '@stellar/stellar-sdk';
import {
	fetchProvenanceJson,
	ProvenanceHttpError
} from './BoundedProvenanceJson.js';
import {
	BuildTrustUnavailable,
	UnsupportedBuildAttestation,
	githubRepository,
	record,
	verifyContractBuildAttestation,
	type ContractBuildRecord
} from './ContractBuildAttestation.js';
import { readContractCode, ContractRpcUnavailable } from './ContractRpcCode.js';
import { readContractWasmMetadata } from './ContractWasmMetadata.js';

export type BuildStatus =
	| 'verified'
	| 'not_published'
	| 'metadata_missing'
	| 'metadata_invalid'
	| 'unsupported'
	| 'invalid'
	| 'unavailable'
	| 'builtin'
	| 'not_found_at_ledger';
export interface ContractProvenance {
	readonly contractId: string;
	readonly networkPassphrase: string;
	readonly observedLedger: number;
	readonly instanceModifiedLedger: number | null;
	readonly checkedAt: string;
	readonly executable: 'wasm' | 'stellar_asset' | 'not_found';
	readonly wasmSha256: string | null;
	readonly metadata: {
		readonly sourceRepository: string | null;
		readonly homeDomain: string | null;
	};
	readonly build: {
		readonly status: BuildStatus;
		readonly record: ContractBuildRecord | null;
	};
	readonly securityAudit: 'not_assessed';
}

export class ProvenanceBusy extends Error {}

export class ContractProvenanceService {
	private readonly cache = new Map<
		string,
		{ expires: number; value: ContractProvenance }
	>();
	private readonly pending = new Map<string, Promise<ContractProvenance>>();
	private readonly builds = new Map<
		string,
		{ expires: number; value: ContractProvenance['build'] }
	>();
	constructor(
		private readonly rpcUrl: URL | undefined,
		private readonly networkPassphrase: string
	) {}

	async get(contractId: string): Promise<ContractProvenance> {
		if (!StrKey.isValidContract(contractId))
			throw new Error('Invalid contract address');
		if (!this.rpcUrl)
			throw new ContractRpcUnavailable('Contract RPC is not configured');
		const existing = this.cache.get(contractId);
		if (existing && existing.expires > Date.now()) return existing.value;
		const pending = this.pending.get(contractId);
		if (pending) return pending;
		if (this.pending.size >= 2)
			throw new ProvenanceBusy('Build verification is busy');
		const job = this.load(contractId)
			.then((value) => {
				this.remember(this.cache, contractId, value, 60_000);
				return value;
			})
			.finally(() => this.pending.delete(contractId));
		this.pending.set(contractId, job);
		return job;
	}

	private async load(contractId: string): Promise<ContractProvenance> {
		const observation = await readContractCode(this.rpcUrl!, contractId);
		let metadata: ContractProvenance['metadata'] = {
			sourceRepository: null,
			homeDomain: null
		};
		let build: ContractProvenance['build'];
		if (observation.executable === 'stellar_asset')
			build = { status: 'builtin', record: null };
		else if (!observation.wasm || !observation.wasmSha256)
			build = { status: 'not_found_at_ledger', record: null };
		else {
			try {
				const parsed = readContractWasmMetadata(
					observation.wasm,
					observation.wasmSha256
				);
				const repository = githubRepository(parsed.sourceRepository);
				metadata = {
					sourceRepository: repository,
					homeDomain:
						parsed.homeDomain &&
						/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(
							parsed.homeDomain
						)
							? parsed.homeDomain
							: null
				};
				build = repository
					? await this.build(repository, observation.wasmSha256)
					: {
							status: parsed.sourceRepository
								? 'unsupported'
								: 'metadata_missing',
							record: null
						};
			} catch {
				build = { status: 'metadata_invalid', record: null };
			}
		}
		return {
			contractId,
			networkPassphrase: this.networkPassphrase,
			observedLedger: observation.ledger,
			instanceModifiedLedger: observation.modifiedLedger || null,
			checkedAt: new Date().toISOString(),
			executable: observation.executable,
			wasmSha256: observation.wasmSha256,
			metadata,
			build,
			securityAudit: 'not_assessed'
		};
	}

	private async build(
		repository: string,
		hash: string
	): Promise<ContractProvenance['build']> {
		const key = repository + ':' + hash;
		const cached = this.builds.get(key);
		if (cached && cached.expires > Date.now()) return cached.value;
		let value: ContractProvenance['build'];
		try {
			const data = record(
				await fetchProvenanceJson(
					new URL(
						'https://api.github.com/repos/' +
							repository +
							'/attestations/sha256:' +
							hash +
							'?per_page=5'
					)
				)
			);
			if (!Array.isArray(data.attestations))
				throw new Error('Invalid attestation response');
			value = {
				status: data.attestations.length ? 'invalid' : 'not_published',
				record: null
			};
			let unavailable = false;
			let invalid = false;
			for (const attestation of data.attestations.slice(0, 5)) {
				try {
					value = {
						status: 'verified',
						record: await verifyContractBuildAttestation(
							record(attestation).bundle,
							repository,
							hash
						)
					};
					break;
				} catch (error) {
					if (error instanceof BuildTrustUnavailable) unavailable = true;
					else if (!(error instanceof UnsupportedBuildAttestation))
						invalid = true;
				}
			}
			if (value.status !== 'verified' && data.attestations.length)
				value = {
					status: unavailable
						? 'unavailable'
						: invalid
							? 'invalid'
							: 'unsupported',
					record: null
				};
		} catch (error) {
			value = {
				status:
					error instanceof ProvenanceHttpError && error.status === 404
						? 'not_published'
						: 'unavailable',
				record: null
			};
		}
		this.remember(
			this.builds,
			key,
			value,
			value.status === 'unavailable' ? 30_000 : 30 * 60_000
		);
		return value;
	}

	private remember<T>(
		cache: Map<string, { expires: number; value: T }>,
		key: string,
		value: T,
		ttl: number
	): void {
		cache.delete(key);
		if (cache.size >= 256) cache.delete(cache.keys().next().value!);
		cache.set(key, { expires: Date.now() + ttl, value });
	}
}

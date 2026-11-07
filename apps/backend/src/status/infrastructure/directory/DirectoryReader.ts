import {
	createAtlasDirectoryEntry,
	projectDirectoryEvidence,
	type AtlasDirectoryEntry,
	type DirectoryEvidence,
	type DirectoryNetwork
} from './DirectoryEvidence.js';
import type {
	ExpertDirectoryCheckpoint,
	ExpertDirectoryEntry
} from './ExpertDirectoryImport.js';
import {
	EXPERT_DIRECTORY_SOURCE,
	parseDirectoryAddress
} from './ExpertDirectoryRecord.js';

const repositoryUrl = 'https://github.com/stellar-expert/public-directory';
const licenseUrl =
	repositoryUrl + '/blob/21fda47ee3b84180598a88ce9a86e11789e6f7be/LICENSE';
const atlasEntryLimit = 1024;
const pageLimit = 50;

export class DirectoryInputError extends Error {}

export interface ImportedDirectorySnapshot {
	readonly checkpoint: ExpertDirectoryCheckpoint | null;
	readonly entries: readonly ExpertDirectoryEntry[];
}

export interface ImportedDirectoryReader {
	lookup(address: string): Promise<ImportedDirectorySnapshot>;
	search(input: {
		readonly prefix: string;
		readonly after: string;
		readonly take: number;
		readonly atlasAddresses: readonly string[];
	}): Promise<ImportedDirectorySnapshot>;
}

/** Current curated Atlas records are supplied separately from the imported read model. */
export class DirectoryReader {
	private readonly atlas = new Map<
		DirectoryNetwork,
		Map<string, AtlasDirectoryEntry>
	>([
		['mainnet', new Map()],
		['testnet', new Map()]
	]);

	constructor(
		private readonly imported: ImportedDirectoryReader,
		atlasEntries: readonly Parameters<typeof createAtlasDirectoryEntry>[0][]
	) {
		if (atlasEntries.length > atlasEntryLimit)
			throw new Error('Atlas directory exceeds its serving limit');
		for (const input of atlasEntries) {
			const entry = createAtlasDirectoryEntry(input);
			const entries = this.atlas.get(entry.networkApplicability)!;
			if (entries.has(entry.address))
				throw new Error('Duplicate Atlas directory address for the network');
			entries.set(entry.address, entry);
		}
	}

	async lookup(network: DirectoryNetwork, address: string) {
		validAddress(address);
		const atlas = this.forNetwork(network);
		const snapshot = await this.imported.lookup(address);
		const upstream = describeUpstream(snapshot.checkpoint);
		return {
			evidence: projectDirectoryEvidence(
				address,
				network,
				snapshot.checkpoint
					? publicImportedEntry(snapshot.entries[0] ?? null)
					: null,
				atlas.get(address) ?? null
			),
			upstream
		};
	}

	async search(
		network: DirectoryNetwork,
		query: unknown,
		after: unknown,
		requestedLimit: unknown
	) {
		const atlas = this.forNetwork(network);
		const prefix = readPrefix(query);
		const cursor = readCursor(after);
		const limit = readLimit(requestedLimit);
		const take = limit + 1;
		const atlasAddresses = [...atlas.values()]
			.filter(
				(entry) =>
					entry.address > cursor &&
					[entry.address, entry.name, entry.domain].some(
						(value) => value !== null && foldAscii(value).startsWith(prefix)
					)
			)
			.map((entry) => entry.address)
			.sort()
			.slice(0, take);
		const snapshot = await this.imported.search({
			prefix,
			after: cursor,
			take,
			atlasAddresses
		});
		const imported = new Map(
			(snapshot.checkpoint ? snapshot.entries : []).map((entry) => [
				entry.address,
				entry
			])
		);
		const addresses = [
			...new Set([...imported.keys(), ...atlasAddresses])
		].sort();
		const items: DirectoryEvidence[] = addresses
			.slice(0, limit)
			.map((address) =>
				projectDirectoryEvidence(
					address,
					network,
					publicImportedEntry(imported.get(address) ?? null),
					atlas.get(address) ?? null
				)
			);
		return {
			network,
			items,
			nextCursor:
				addresses.length > limit ? items[items.length - 1]!.address : null,
			upstream: describeUpstream(snapshot.checkpoint)
		};
	}

	private forNetwork(network: DirectoryNetwork) {
		const entries = this.atlas.get(network);
		if (!entries)
			throw new DirectoryInputError('Use network mainnet or testnet');
		return entries;
	}
}

function readPrefix(value: unknown): string {
	if (
		typeof value !== 'string' ||
		value.length > 80 ||
		/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
	)
		throw new DirectoryInputError('Supply a query of 3 to 80 characters');
	const prefix = value.trim();
	if (prefix.length < 3)
		throw new DirectoryInputError('Supply a query of 3 to 80 characters');
	return foldAscii(prefix);
}

function readLimit(value: unknown): number {
	if (value === undefined) return 20;
	if (
		typeof value !== 'string' ||
		!/^[1-9][0-9]?$/.test(value) ||
		Number(value) > pageLimit
	)
		throw new DirectoryInputError('Use a limit from 1 to 50');
	return Number(value);
}

function readCursor(value: unknown): string {
	if (value === undefined) return '';
	if (typeof value !== 'string')
		throw new DirectoryInputError('Use a valid address cursor');
	validAddress(value);
	return value;
}

function validAddress(address: string): void {
	try {
		parseDirectoryAddress(address);
	} catch {
		throw new DirectoryInputError(
			'Use a valid Stellar account or contract address'
		);
	}
}

function foldAscii(value: string): string {
	return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function describeUpstream(checkpoint: ExpertDirectoryCheckpoint | null) {
	return {
		source: EXPERT_DIRECTORY_SOURCE,
		publisher: 'StellarExpert' as const,
		networkApplicability: 'unspecified' as const,
		license: 'MIT' as const,
		copyright: 'Copyright (c) 2022 StellarExpert',
		repositoryUrl,
		licenseUrl,
		refreshState: checkpoint
			? ('imported' as const)
			: ('uninitialized' as const),
		checkpoint: checkpoint && {
			commit: checkpoint.commit,
			observedAt: checkpoint.observedAt,
			previousCommit: checkpoint.previousCommit,
			deltaSha256: checkpoint.deltaSha256
		}
	};
}

function publicImportedEntry(
	entry: ExpertDirectoryEntry | null
): ExpertDirectoryEntry | null {
	if (!entry) return null;
	const { source, address, addressKind, commit, observedAt, sourcePath } =
		entry;
	const provenance = {
		source,
		address,
		addressKind,
		commit,
		observedAt,
		sourcePath
	};
	if (entry.state === 'deleted')
		return {
			...provenance,
			state: entry.state,
			previousBlobOid: entry.previousBlobOid
		};
	const {
		state,
		name,
		domain,
		tags,
		version,
		publisher,
		license,
		networkApplicability,
		sourceBlobOid,
		contentSha256
	} = entry;
	return {
		...provenance,
		state,
		name,
		domain,
		tags,
		version,
		publisher,
		license,
		networkApplicability,
		sourceBlobOid,
		contentSha256
	};
}

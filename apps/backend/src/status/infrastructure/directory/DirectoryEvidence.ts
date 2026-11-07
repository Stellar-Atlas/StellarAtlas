import type { ExpertDirectoryEntry } from './ExpertDirectoryImport.js';
import {
	EXPERT_DIRECTORY_SOURCE,
	normalizeDirectoryPublicFields,
	parseDirectoryAddress,
	type DirectoryAddress,
	type DirectoryPublicFields
} from './ExpertDirectoryRecord.js';

export const ATLAS_DIRECTORY_SOURCE = 'stellaratlas/overlay';
export type DirectoryNetwork = 'mainnet' | 'testnet';
export type DirectoryConflict = 'name' | 'domain';

export interface AtlasDirectoryEntry
	extends DirectoryAddress, DirectoryPublicFields {
	readonly source: typeof ATLAS_DIRECTORY_SOURCE;
	readonly publisher: 'StellarAtlas';
	readonly networkApplicability: DirectoryNetwork;
	readonly revision: number;
	readonly observedAt: string;
}

export function createAtlasDirectoryEntry(input: {
	readonly address: string;
	readonly name: string;
	readonly domain?: string | null;
	readonly tags: readonly string[];
	readonly network: DirectoryNetwork;
	readonly revision: number;
	readonly observedAt: string;
}): AtlasDirectoryEntry {
	const timestamp =
		typeof input.observedAt === 'string' && input.observedAt.length <= 64
			? Date.parse(input.observedAt)
			: NaN;
	if (
		!Number.isSafeInteger(input.revision) ||
		input.revision < 1 ||
		!Number.isFinite(timestamp) ||
		!isDirectoryNetwork(input.network)
	)
		throw new Error('Invalid Atlas directory revision');
	return {
		...parseDirectoryAddress(input.address),
		...normalizeDirectoryPublicFields(input),
		source: ATLAS_DIRECTORY_SOURCE,
		publisher: 'StellarAtlas',
		networkApplicability: input.network,
		revision: input.revision,
		observedAt: new Date(timestamp).toISOString()
	};
}

export interface DirectoryEvidence extends DirectoryAddress {
	readonly network: DirectoryNetwork;
	readonly imported: ExpertDirectoryEntry | null;
	readonly atlas: AtlasDirectoryEntry | null;
	readonly conflicts: readonly DirectoryConflict[];
}

/** Pair independently stored observations for an exact address without selecting a preferred claim. */
export function projectDirectoryEvidence(
	address: string,
	network: DirectoryNetwork,
	imported: ExpertDirectoryEntry | null,
	atlas: AtlasDirectoryEntry | null
): DirectoryEvidence {
	const identity = parseDirectoryAddress(address);
	if (!isDirectoryNetwork(network))
		throw new Error('Invalid directory network');
	if (
		imported &&
		(imported.source !== EXPERT_DIRECTORY_SOURCE ||
			imported.address !== address ||
			imported.addressKind !== identity.addressKind)
	)
		throw new Error('Imported evidence does not match the address');
	if (
		atlas &&
		(atlas.source !== ATLAS_DIRECTORY_SOURCE ||
			atlas.address !== address ||
			atlas.addressKind !== identity.addressKind ||
			atlas.networkApplicability !== network)
	)
		throw new Error('Atlas evidence does not match the address or network');

	const conflicts: DirectoryConflict[] = [];
	if (atlas && imported?.state === 'active') {
		if (atlas.name !== imported.name) conflicts.push('name');
		if (atlas.domain && imported.domain && atlas.domain !== imported.domain)
			conflicts.push('domain');
	}
	return { ...identity, network, imported, atlas, conflicts };
}

function isDirectoryNetwork(value: unknown): value is DirectoryNetwork {
	return value === 'mainnet' || value === 'testnet';
}

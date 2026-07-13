import PublicKey from './PublicKey.js';
import Node from './Node.js';

export interface KnownNodeIdentity {
	publicKey: string;
	dateDiscovered: Date;
	lastMeasurementAt: Date | null;
}

export type KnownNodeRepositoryScope =
	| 'current-validator'
	| 'listener'
	| 'public-key-only'
	| 'archived'
	| 'all-known';

export interface KnownNodePageRequest {
	readonly limit: number;
	readonly offset: number;
	readonly organizationPublicKeys: readonly string[];
	readonly query: string;
	readonly scope: KnownNodeRepositoryScope;
}

export interface KnownNodePageItem {
	readonly identity: KnownNodeIdentity;
	readonly node: Node | null;
}

export interface KnownNodePage {
	readonly items: KnownNodePageItem[];
	readonly scopeTotals: Record<KnownNodeRepositoryScope, number>;
	readonly total: number;
}

//active means that the node is not archived. i.e. snapshot endDate = SNAPSHOT_MAX_END_DATE
export interface NodeRepository {
	save(nodes: Node[], from: Date): Promise<Node[]>;
	findActiveAtTimePoint(at: Date): Promise<Node[]>;
	findActive(): Promise<Node[]>;
	findActiveByPublicKey(publicKeys: string[]): Promise<Node[]>;
	findAllKnown(): Promise<Node[]>;
	findKnownPage(request: KnownNodePageRequest): Promise<KnownNodePage>;
	findKnownByPublicKeysOrHomeDomain(
		publicKeys: string[],
		homeDomain: string | null
	): Promise<Node[]>;
	findKnownByHistoryUrl(historyUrl: string): Promise<Node[]>;
	findAllKnownIdentities(): Promise<KnownNodeIdentity[]>;
	findKnownIdentityByPublicKey(
		publicKey: string
	): Promise<KnownNodeIdentity | null>;
	findActiveByPublicKeyAtTimePoint(
		publicKey: PublicKey,
		at: Date
	): Promise<Node | null>;
	findByPublicKey(publicKeys: PublicKey[]): Promise<Node[]>; //active or not
	findOneByPublicKey(publicKey: PublicKey): Promise<Node | null>; //active or not
}

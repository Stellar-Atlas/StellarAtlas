import PublicKey from './PublicKey.js';
import Node from './Node.js';

export interface KnownNodeIdentity {
	publicKey: string;
	dateDiscovered: Date;
	lastMeasurementAt: Date | null;
}

//active means that the node is not archived. i.e. snapshot endDate = SNAPSHOT_MAX_END_DATE
export interface NodeRepository {
	save(nodes: Node[], from: Date): Promise<Node[]>;
	findActiveAtTimePoint(at: Date): Promise<Node[]>;
	findActive(): Promise<Node[]>;
	findActiveByPublicKey(publicKeys: string[]): Promise<Node[]>;
	findAllKnown(): Promise<Node[]>;
	findKnownByPublicKeysOrHomeDomain(
		publicKeys: string[],
		homeDomain: string | null
	): Promise<Node[]>;
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

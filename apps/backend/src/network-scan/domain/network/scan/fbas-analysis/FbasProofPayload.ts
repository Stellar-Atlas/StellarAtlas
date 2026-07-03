export const fbasProofPayloadVersion = 1;
export const maxFbasProofSetsPerFamily = 32;
export const maxFbasProofSetMembers = 32;
export const maxFbasTopTierMembers = 512;
export const maxFbasSymmetricTopTierDepth = 4;
export const maxFbasSymmetricTopTierInnerSets = 16;
export const maxFbasProofPayloadBytes = 1_000_000;

export type FbasProofPayloadVersion = typeof fbasProofPayloadVersion;
export type FbasProofSet = readonly string[];

export interface FbasSymmetricTopTierProof {
	readonly threshold: number;
	readonly validators: readonly string[];
	readonly innerQuorumSets?: readonly FbasSymmetricTopTierProof[] | null;
}

export interface FbasMinimalQuorumsProof {
	readonly min: number;
	readonly quorumIntersection: boolean;
	readonly result: readonly FbasProofSet[];
	readonly size: number;
}

export interface FbasMergedAnalysisProof {
	readonly blockingSets: readonly FbasProofSet[];
	readonly blockingSetsCount: number;
	readonly blockingSetsFiltered: readonly FbasProofSet[];
	readonly blockingSetsFilteredCount: number;
	readonly blockingSetsFilteredMinSize: number;
	readonly blockingSetsMinSize: number;
	readonly splittingSets: readonly FbasProofSet[];
	readonly splittingSetsCount: number;
	readonly splittingSetsMinSize: number;
	readonly topTier: readonly string[];
	readonly topTierSize: number;
}

export interface FbasCaptureLimits {
	readonly proofSetMembers: number;
	readonly proofSetsPerFamily: number;
	readonly symmetricTopTierDepth: number;
	readonly symmetricTopTierInnerSets: number;
	readonly topTierMembers: number;
}

export interface FbasProofSetFamily {
	readonly captureLimit: number;
	readonly capturedCount: number;
	readonly complete: boolean;
	readonly memberLimit: number;
	readonly minSize: number;
	readonly sets: readonly FbasProofSet[];
	readonly totalCount: number;
}

export interface FbasMembershipCapture {
	readonly captureLimit: number;
	readonly capturedCount: number;
	readonly complete: boolean;
	readonly members: readonly string[];
	readonly totalCount: number;
}

export interface FbasSymmetricTopTierProofArtifact {
	readonly complete: boolean;
	readonly innerQuorumSets: readonly FbasSymmetricTopTierProofArtifact[] | null;
	readonly innerQuorumSetsCaptureLimit: number;
	readonly threshold: number;
	readonly validators: FbasMembershipCapture;
}

export interface FbasMinimalQuorumsProofArtifact {
	readonly quorumIntersection: boolean;
	readonly quorums: FbasProofSetFamily;
}

export interface FbasMergedProofArtifact {
	readonly blockingSets: FbasProofSetFamily;
	readonly blockingSetsFiltered: FbasProofSetFamily;
	readonly splittingSets: FbasProofSetFamily;
	readonly topTier: FbasMembershipCapture;
}

export interface FbasProofPayload {
	readonly complete: boolean;
	readonly country: FbasMergedProofArtifact;
	readonly hasQuorumIntersection: boolean;
	readonly hasSymmetricTopTier: boolean;
	readonly isp: FbasMergedProofArtifact;
	readonly limits: FbasCaptureLimits;
	readonly minimalQuorums: FbasMinimalQuorumsProofArtifact;
	readonly node: FbasMergedProofArtifact;
	readonly organization: FbasMergedProofArtifact;
	readonly symmetricTopTier: FbasSymmetricTopTierProofArtifact | null;
	readonly version: FbasProofPayloadVersion;
}

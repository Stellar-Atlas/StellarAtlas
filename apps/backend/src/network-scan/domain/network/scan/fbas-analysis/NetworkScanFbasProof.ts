import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { AnalysisResult } from './AnalysisResult.js';
import {
	type FbasCaptureLimits,
	type FbasMembershipCapture,
	type FbasMergedAnalysisProof,
	type FbasMergedProofArtifact,
	type FbasMinimalQuorumsProof,
	type FbasMinimalQuorumsProofArtifact,
	type FbasProofPayload,
	type FbasProofSet,
	type FbasProofSetFamily,
	type FbasSymmetricTopTierProof,
	type FbasSymmetricTopTierProofArtifact,
	fbasProofPayloadVersion,
	maxFbasProofPayloadBytes,
	maxFbasProofSetMembers,
	maxFbasProofSetsPerFamily,
	maxFbasSymmetricTopTierDepth,
	maxFbasSymmetricTopTierInnerSets,
	maxFbasTopTierMembers
} from './FbasProofPayload.js';

@Entity('network_scan_fbas_proof')
export class NetworkScanFbasProof {
	@PrimaryColumn('integer', { name: 'scan_id' })
	scanId = 0;

	@Column('timestamptz', { name: 'scan_time' })
	scanTime!: Date;

	@Column('smallint', {
		default: fbasProofPayloadVersion,
		name: 'schema_version'
	})
	schemaVersion = fbasProofPayloadVersion;

	@Column('jsonb', { name: 'payload' })
	payload!: FbasProofPayload;

	@Column('integer', { name: 'payload_bytes' })
	payloadBytes = 0;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt?: Date;

	constructor(scanTime?: Date, payload?: FbasProofPayload) {
		if (scanTime) this.scanTime = scanTime;
		if (payload) this.setPayload(payload);
	}

	static fromAnalysisResult(
		scanTime: Date,
		analysisResult: AnalysisResult
	): NetworkScanFbasProof {
		return new NetworkScanFbasProof(
			scanTime,
			buildPayloadWithinByteLimit(analysisResult)
		);
	}

	setPayload(payload: FbasProofPayload): void {
		this.payload = payload;
		this.payloadBytes = measurePayloadBytes(payload);
	}
}

function buildPayloadWithinByteLimit(
	analysisResult: AnalysisResult
): FbasProofPayload {
	let limits = defaultLimits();
	let payload = buildPayload(analysisResult, limits);

	while (
		measurePayloadBytes(payload) > maxFbasProofPayloadBytes &&
		canReduceLimits(limits)
	) {
		limits = reduceLimits(limits);
		payload = buildPayload(analysisResult, limits);
	}

	return payload;
}

function buildPayload(
	analysisResult: AnalysisResult,
	limits: FbasCaptureLimits
): FbasProofPayload {
	const node = toMergedProofArtifact(analysisResult.node, limits);
	const organization = toMergedProofArtifact(
		analysisResult.organization,
		limits
	);
	const country = toMergedProofArtifact(analysisResult.country, limits);
	const isp = toMergedProofArtifact(analysisResult.isp, limits);
	const minimalQuorums = toMinimalQuorumsArtifact(
		analysisResult.minimalQuorums,
		limits
	);
	const symmetricTopTier = analysisResult.symmetricTopTier
		? toSymmetricTopTierArtifact(analysisResult.symmetricTopTier, limits, 0)
		: null;

	return {
		complete:
			nodeIsComplete(node) &&
			nodeIsComplete(organization) &&
			nodeIsComplete(country) &&
			nodeIsComplete(isp) &&
			minimalQuorums.quorums.complete &&
			(symmetricTopTier?.complete ?? true),
		country,
		hasQuorumIntersection: analysisResult.hasQuorumIntersection,
		hasSymmetricTopTier: analysisResult.hasSymmetricTopTier,
		isp,
		limits,
		minimalQuorums,
		node,
		organization,
		symmetricTopTier,
		version: fbasProofPayloadVersion
	};
}

function toMergedProofArtifact(
	proof: FbasMergedAnalysisProof,
	limits: FbasCaptureLimits
): FbasMergedProofArtifact {
	return {
		blockingSets: captureProofSets(
			proof.blockingSets,
			proof.blockingSetsCount,
			proof.blockingSetsMinSize,
			limits
		),
		blockingSetsFiltered: captureProofSets(
			proof.blockingSetsFiltered,
			proof.blockingSetsFilteredCount,
			proof.blockingSetsFilteredMinSize,
			limits
		),
		splittingSets: captureProofSets(
			proof.splittingSets,
			proof.splittingSetsCount,
			proof.splittingSetsMinSize,
			limits
		),
		topTier: captureMembers(
			proof.topTier,
			proof.topTierSize,
			limits.topTierMembers
		)
	};
}

function toMinimalQuorumsArtifact(
	proof: FbasMinimalQuorumsProof,
	limits: FbasCaptureLimits
): FbasMinimalQuorumsProofArtifact {
	return {
		quorumIntersection: proof.quorumIntersection,
		quorums: captureProofSets(proof.result, proof.size, proof.min, limits)
	};
}

function toSymmetricTopTierArtifact(
	proof: FbasSymmetricTopTierProof,
	limits: FbasCaptureLimits,
	depth: number
): FbasSymmetricTopTierProofArtifact {
	const innerQuorumSets =
		proof.innerQuorumSets === null || proof.innerQuorumSets === undefined
			? null
			: proof.innerQuorumSets
					.slice(0, limits.symmetricTopTierInnerSets)
					.map((inner) =>
						depth < limits.symmetricTopTierDepth
							? toSymmetricTopTierArtifact(inner, limits, depth + 1)
							: toTruncatedSymmetricTopTierArtifact(inner, limits)
					);
	const innerComplete =
		proof.innerQuorumSets === null ||
		proof.innerQuorumSets === undefined ||
		proof.innerQuorumSets.length === 0 ||
		(proof.innerQuorumSets.length <= limits.symmetricTopTierInnerSets &&
			depth < limits.symmetricTopTierDepth &&
			innerQuorumSets?.every((inner) => inner.complete) !== false);

	const validators = captureMembers(
		proof.validators,
		proof.validators.length,
		limits.proofSetMembers
	);

	return {
		complete: validators.complete && innerComplete,
		innerQuorumSets,
		innerQuorumSetsCaptureLimit: limits.symmetricTopTierInnerSets,
		threshold: proof.threshold,
		validators
	};
}

function toTruncatedSymmetricTopTierArtifact(
	proof: FbasSymmetricTopTierProof,
	limits: FbasCaptureLimits
): FbasSymmetricTopTierProofArtifact {
	return {
		complete: false,
		innerQuorumSets: [],
		innerQuorumSetsCaptureLimit: limits.symmetricTopTierInnerSets,
		threshold: proof.threshold,
		validators: captureMembers(
			proof.validators,
			proof.validators.length,
			limits.proofSetMembers
		)
	};
}

function captureProofSets(
	sets: readonly FbasProofSet[],
	totalCount: number,
	minSize: number,
	limits: FbasCaptureLimits
): FbasProofSetFamily {
	const capturedSets = sets
		.map((set) => [...set].sort())
		.sort(compareStringArrays)
		.slice(0, limits.proofSetsPerFamily)
		.map((set) => set.slice(0, limits.proofSetMembers));

	const hasTruncatedMembers = sets.some(
		(set) => set.length > limits.proofSetMembers
	);

	return {
		captureLimit: limits.proofSetsPerFamily,
		capturedCount: capturedSets.length,
		complete:
			totalCount <= limits.proofSetsPerFamily &&
			sets.length >= totalCount &&
			!hasTruncatedMembers &&
			sets.length <= limits.proofSetsPerFamily,
		memberLimit: limits.proofSetMembers,
		minSize,
		sets: capturedSets,
		totalCount
	};
}

function captureMembers(
	members: readonly string[],
	totalCount: number,
	captureLimit: number
): FbasMembershipCapture {
	const capturedMembers = [...members].sort().slice(0, captureLimit);

	return {
		captureLimit,
		capturedCount: capturedMembers.length,
		complete:
			totalCount <= captureLimit &&
			members.length >= totalCount &&
			members.length <= captureLimit,
		members: capturedMembers,
		totalCount
	};
}

function nodeIsComplete(proof: FbasMergedProofArtifact): boolean {
	return (
		proof.blockingSets.complete &&
		proof.blockingSetsFiltered.complete &&
		proof.splittingSets.complete &&
		proof.topTier.complete
	);
}

function defaultLimits(): FbasCaptureLimits {
	return {
		proofSetMembers: maxFbasProofSetMembers,
		proofSetsPerFamily: maxFbasProofSetsPerFamily,
		symmetricTopTierDepth: maxFbasSymmetricTopTierDepth,
		symmetricTopTierInnerSets: maxFbasSymmetricTopTierInnerSets,
		topTierMembers: maxFbasTopTierMembers
	};
}

function canReduceLimits(limits: FbasCaptureLimits): boolean {
	return (
		limits.proofSetMembers > 0 ||
		limits.proofSetsPerFamily > 0 ||
		limits.symmetricTopTierDepth > 0 ||
		limits.symmetricTopTierInnerSets > 0 ||
		limits.topTierMembers > 0
	);
}

function reduceLimits(limits: FbasCaptureLimits): FbasCaptureLimits {
	return {
		proofSetMembers: halve(limits.proofSetMembers),
		proofSetsPerFamily: halve(limits.proofSetsPerFamily),
		symmetricTopTierDepth: halve(limits.symmetricTopTierDepth),
		symmetricTopTierInnerSets: halve(limits.symmetricTopTierInnerSets),
		topTierMembers: halve(limits.topTierMembers)
	};
}

function halve(value: number): number {
	return value <= 1 ? 0 : Math.floor(value / 2);
}

function compareStringArrays(left: string[], right: string[]): number {
	const maxLength = Math.max(left.length, right.length);
	for (let index = 0; index < maxLength; index += 1) {
		const leftValue = left[index];
		const rightValue = right[index];
		if (leftValue === undefined) return -1;
		if (rightValue === undefined) return 1;
		const comparison = leftValue.localeCompare(rightValue);
		if (comparison !== 0) return comparison;
	}

	return 0;
}

function measurePayloadBytes(payload: FbasProofPayload): number {
	return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

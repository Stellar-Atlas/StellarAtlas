import Node from '../Node.js';
import { PeerNode } from 'crawler';
import {
	InvalidPeerNode,
	PeerNodeToNodeMapper
} from './node-crawl/PeerNodeToNodeMapper.js';
import NodeMeasurement from '../NodeMeasurement.js';
import NodeDetails from '../NodeDetails.js';
import NodeGeoDataLocation from '../NodeGeoDataLocation.js';
import { NodeTomlInfo } from './NodeTomlInfo.js';
import { SemanticVersionComparer } from 'shared';
import { StellarCoreVersion } from '../../network/StellarCoreVersion.js';

export interface HistoryArchiveSchedulingCounters {
	readonly discoveredArchiveUrlCount: number;
	readonly scheduledArchiveScanJobCount: number;
	readonly duplicateSuppressedArchiveScanJobCount: number;
	readonly schedulerErrorCount: number;
}

export class NodeScan {
	public processedLedgers: number[] = [];
	public latestLedger = BigInt(0);
	public latestLedgerCloseTime: Date | null = null;
	public historyArchiveSchedulingDiscoveredUrlCount = 0;
	public historyArchiveSchedulingScheduledCount = 0;
	public historyArchiveSchedulingDuplicateSuppressedCount = 0;
	public historyArchiveSchedulingErrorCount = 0;

	constructor(
		public readonly time: Date,
		public readonly nodes: Node[]
	) {}

	public processCrawl(
		peerNodes: PeerNode[],
		archivedNodes: Node[] = [],
		processedLedgers: number[] = [],
		latestLedger = BigInt(0),
		latestLedgerCloseTime: Date | null = null
	): InvalidPeerNode[] {
		this.processedLedgers = processedLedgers;
		this.latestLedger = latestLedger;
		this.latestLedgerCloseTime = latestLedgerCloseTime;

		const invalidPeerNodes: InvalidPeerNode[] = [];

		peerNodes.forEach((peerNode) => {
			const node = this.getNodeByPublicKeyString(peerNode.publicKey);
			if (node) {
				return PeerNodeToNodeMapper.updateNodeFromPeerNode(
					node,
					peerNode,
					this.time
				);
			}

			const archivedNode = archivedNodes.find(
				(archivedNode) => archivedNode.publicKey.value === peerNode.publicKey
			);

			if (archivedNode) {
				archivedNode.unArchive(this.time);
				PeerNodeToNodeMapper.updateNodeFromPeerNode(
					archivedNode,
					peerNode,
					this.time
				);
				this.nodes.push(archivedNode);
				return;
			}

			const createdNodeOrError = PeerNodeToNodeMapper.createNodeFromPeerNode(
				peerNode,
				this.time
			);
			if (createdNodeOrError.isErr()) {
				invalidPeerNodes.push(createdNodeOrError.error);
			} else {
				this.nodes.push(createdNodeOrError.value);
			}
		});

		this.nodes
			.filter(
				(node) =>
					node.latestMeasurement()?.time.getTime() !== this.time.getTime()
			)
			.forEach((node) =>
				node.addMeasurement(new NodeMeasurement(this.time, node))
			);

		return invalidPeerNodes;
	}

	getPublicKeys(): string[] {
		return this.nodes.map((node) => node.publicKey.value);
	}

	updateHomeDomains(homeDomains: Map<string, string>) {
		this.nodes.forEach((node) => {
			const homeDomain = homeDomains.get(node.publicKey.value);
			if (homeDomain) {
				node.updateHomeDomain(homeDomain, this.time);
			}
		});
	}

	updateWithTomlInfo(nodeTomlInfoCollection: Set<NodeTomlInfo>) {
		nodeTomlInfoCollection.forEach((nodeTomlInfo) => {
			const node = this.nodes.find(
				(node) => node.publicKey.value === nodeTomlInfo.publicKey
			);
			if (node && node.homeDomain === nodeTomlInfo.homeDomain)
				node.updateDetails(
					NodeDetails.create({
						alias: nodeTomlInfo.alias,
						historyUrl: nodeTomlInfo.historyUrl,
						name: nodeTomlInfo.name,
						host: nodeTomlInfo.host
					}),
					this.time
				);
		});
	}

	updateStellarCoreVersionBehindStatus(stellarCoreVersion: StellarCoreVersion) {
		this.nodes.forEach((node) => {
			const measurement = node.latestMeasurement();
			if (measurement) {
				if (node.versionStr)
					measurement.stellarCoreVersionBehind =
						SemanticVersionComparer.isBehind(
							node.versionStr,
							stellarCoreVersion.value
						);
			} else throw new Error('Measurement not found');
		});
	}

	getHomeDomains(): string[] {
		return this.nodes
			.filter((node) => node.homeDomain)
			.map((node) => node.homeDomain as string);
	}

	getHistoryArchiveUrls(): Map<string, string> {
		return new Map(
			this.nodes
				.filter((node) => node.details?.historyUrl)
				.map((node) => [
					node.publicKey.value,
					node.details?.historyUrl as string
				])
		);
	}

	updateHistoryArchiveSchedulingCounters(
		counters: HistoryArchiveSchedulingCounters
	): void {
		this.historyArchiveSchedulingDiscoveredUrlCount = toNonNegativeInteger(
			counters.discoveredArchiveUrlCount
		);
		this.historyArchiveSchedulingScheduledCount = toNonNegativeInteger(
			counters.scheduledArchiveScanJobCount
		);
		this.historyArchiveSchedulingDuplicateSuppressedCount =
			toNonNegativeInteger(counters.duplicateSuppressedArchiveScanJobCount);
		this.historyArchiveSchedulingErrorCount = toNonNegativeInteger(
			counters.schedulerErrorCount
		);
	}

	updateHistoryArchiveUpToDateStatus(
		nodesWithUpToDateHistoryArchives: Set<string>
	) {
		this.nodes
			.filter((node) =>
				nodesWithUpToDateHistoryArchives.has(node.publicKey.value)
			)
			.forEach((node) => {
				const measurement = node.latestMeasurement();
				if (!measurement) throw new Error('Measurement not found');
				measurement.isFullValidator = nodesWithUpToDateHistoryArchives.has(
					node.publicKey.value
				);
			});
	}

	public getModifiedIPs(): string[] {
		return this.nodes
			.filter(
				(node) =>
					node.lastIpChange &&
					node.lastIpChange.getTime() === this.time.getTime()
			)
			.map((node) => node.ip);
	}

	public getIPsRequiringGeoDataRefresh(): string[] {
		return Array.from(
			new Set(
				this.nodes
					.filter((node) => {
						const geoData = node.geoData;
						return (
							(node.lastIpChange !== null &&
								node.lastIpChange.getTime() === this.time.getTime()) ||
							geoData === null ||
							geoData.countryName === null ||
							geoData.countryCode === null ||
							geoData.latitude === null ||
							geoData.longitude === null ||
							node.isp === null
						);
					})
					.map((node) => node.ip)
			)
		);
	}

	public updateIndexes(indexes: Map<string, number>) {
		this.nodes.forEach((node) => {
			const measurement = node.latestMeasurement();
			if (measurement)
				measurement.index = indexes.get(node.publicKey.value) ?? 0;
			else throw new Error('Measurement not found');
		});
	}

	updateGeoDataAndISP(
		geoData: Map<string, { geo: NodeGeoDataLocation; isp: string | null }>
	) {
		this.nodes.forEach((node) => {
			const geoDataAndISP = geoData.get(node.ip);
			if (geoDataAndISP) {
				node.updateGeoData(geoDataAndISP.geo, this.time);
			}

			const isp = geoDataAndISP?.isp;
			if (isp) {
				node.updateIsp(isp, this.time);
			}
		});
	}

	public getNodeByPublicKeyString(publicKey: string): Node | undefined {
		return this.nodes.find((node) => node.publicKey.value === publicKey);
	}

	getActiveWatchersCount(): number {
		return this.nodes.filter(
			(node) => node.isWatcher() && node.isActive() && !node.isValidating()
		).length;
	}

	getConnectableNodesCount(): number {
		return this.nodes.filter((node) => node.isActive()).length;
	}

	getActiveValidatorsCount(): number {
		return this.nodes.filter((node) => node.isValidating()).length;
	}

	getActiveFullValidatorsCount(): number {
		return this.nodes.filter((node) => node.isTrackingFullValidator()).length;
	}
}

function toNonNegativeInteger(value: number): number {
	if (!Number.isFinite(value)) return 0;

	return Math.max(0, Math.trunc(value));
}

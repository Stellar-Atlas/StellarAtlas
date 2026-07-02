export type QuorumSet = {
	t: number;
	v: Array<string | QuorumSet>;
};

export type NetworkGraphNode = {
	node: string;
	distance: number;
	status: string;
	qset?: QuorumSet;
};

export type HaltingFailure = {
	vulnerableNodes: NetworkGraphNode[];
	affectedNodes: NetworkGraphNode[];
};

type AnalysisNode = {
	name: string;
	live: boolean;
	status: string;
	quorumSet: AnalysisQuorumSet;
	dependentsNames: string[];
	networkObject: NetworkGraphNode;
};

type AnalysisQuorumSet = {
	threshold: number;
	dependencies: Array<string | AnalysisQuorumSet>;
};

function isQuorumSet(
	dependency: string | AnalysisQuorumSet
): dependency is AnalysisQuorumSet {
	return typeof dependency !== 'string';
}

function isNested(dependency: string | QuorumSet): dependency is QuorumSet {
	return typeof dependency !== 'string';
}

export function createAnalysisStructure(nodes: NetworkGraphNode[]): {
	root: AnalysisNode;
	entries: AnalysisNode[];
} {
	const myNode = nodes.find((node) => node.distance === 0);
	if (!myNode) throw new Error('No node with distance 0 in halting analysis');

	const entryCache = new Map<string, AnalysisNode>();
	const root = generateNode(myNode);

	function generateNode(node: NetworkGraphNode): AnalysisNode {
		const cached = entryCache.get(node.node);
		if (cached) return cached;

		const entry: AnalysisNode = {
			networkObject: node,
			name: node.node,
			live: true,
			status: node.status,
			quorumSet: {
				threshold: 0,
				dependencies: []
			},
			dependentsNames: []
		};
		entryCache.set(entry.name, entry);

		if (node.qset) {
			generateQuorumSet(node.qset, entry, entry.quorumSet);
		} else if (node.status === 'missing') {
			entry.live = false;
		} else {
			throw new Error(`Bad state, no quorum set on non-missing node ${node.node}`);
		}

		return entry;
	}

	function generateQuorumSet(
		set: QuorumSet,
		entry: AnalysisNode,
		analysisQuorumSet: AnalysisQuorumSet
	): void {
		analysisQuorumSet.threshold = set.t;

		for (const dependent of set.v) {
			if (isNested(dependent)) {
				const nestedAnalysisQuorumSet: AnalysisQuorumSet = {
					threshold: 0,
					dependencies: []
				};
				analysisQuorumSet.dependencies.push(nestedAnalysisQuorumSet);
				generateQuorumSet(dependent, entry, nestedAnalysisQuorumSet);
				continue;
			}

			const dependentNetworkNode = nodes.find(
				(node) => node.node === dependent
			);
			if (!dependentNetworkNode)
				throw new Error(`Bad network graph: no node named ${dependent}`);

			const dependentNode = generateNode(dependentNetworkNode);
			analysisQuorumSet.dependencies.push(dependentNode.name);
			dependentNode.dependentsNames.push(entry.name);
		}
	}

	return { root, entries: Array.from(entryCache.values()) };
}

function reset(nodes: AnalysisNode[]): void {
	for (const node of nodes) node.live = node.status !== 'missing';
}

export function generateCombinations<T>(items: T[], maxSize: number): T[][] {
	const results: T[][] = [];
	if (maxSize <= 0) return results;

	items.forEach((item, index) => {
		results.push([item]);
		const others = items.slice(index + 1);
		const otherCombinations = generateCombinations(others, maxSize - 1);
		otherCombinations.forEach((combination) =>
			results.push([item, ...combination])
		);
	});

	return results.sort((first, second) => first.length - second.length);
}

export function haltingAnalysis(
	nodes: NetworkGraphNode[],
	numberOfNodesToTest = 1
): HaltingFailure[] {
	const failureCases: HaltingFailure[] = [];
	const { root, entries: analysisNodes } = createAnalysisStructure(nodes);

	function getNode(name: string): AnalysisNode {
		const node = analysisNodes.find((analysisNode) => analysisNode.name === name);
		if (!node) throw new Error(`Bad analysis graph: no node named ${name}`);
		return node;
	}

	const failureSets = generateCombinations(analysisNodes, numberOfNodesToTest);
	for (const nodesToHalt of failureSets) {
		if (nodesToHalt.includes(root)) continue;

		const hasKnownSubsetFailure = failureCases.some((failureCase) =>
			failureCase.vulnerableNodes.every((node) =>
				nodesToHalt.some((analysisNode) => analysisNode.networkObject === node)
			)
		);
		if (hasKnownSubsetFailure) continue;

		reset(analysisNodes);
		let deadNodes: NetworkGraphNode[] = [];

		nodesToHalt.forEach((node) => {
			node.live = false;
		});
		nodesToHalt.forEach((node) => checkDependents(node));

		function checkDependents(deadNode: AnalysisNode): void {
			for (const nodeName of deadNode.dependentsNames) {
				const dependentNode = getNode(nodeName);
				if (
					dependentNode.live &&
					!quorumSetMeetsThreshold(dependentNode.quorumSet)
				) {
					dependentNode.live = false;
					deadNodes.push(dependentNode.networkObject);
					checkDependents(dependentNode);
				}
			}
		}

		function quorumSetMeetsThreshold(quorumSet: AnalysisQuorumSet): boolean {
			let threshold = quorumSet.threshold;

			for (const dependent of quorumSet.dependencies) {
				if (isQuorumSet(dependent)) {
					if (quorumSetMeetsThreshold(dependent)) threshold -= 1;
					continue;
				}

				const dependentNode = getNode(dependent);
				if (dependentNode.live) threshold -= 1;
				else deadNodes.push(dependentNode.networkObject);
			}

			return threshold <= 0;
		}

		if (!root.live) {
			deadNodes = Array.from(new Set(deadNodes));
			failureCases.push({
				vulnerableNodes: nodesToHalt.map((node) => node.networkObject),
				affectedNodes: deadNodes
			});
		}
	}

	return failureCases.sort(
		(first, second) =>
			first.vulnerableNodes.length - second.vulnerableNodes.length
	);
}

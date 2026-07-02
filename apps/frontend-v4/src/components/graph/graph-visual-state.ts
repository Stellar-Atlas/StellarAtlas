export interface GraphVisualState {
	activeNodeWeights: ReadonlyMap<string, number>;
	focusedOrganizationId: string | null;
	hoveredNodeId: string | null;
	selectedQuorumNodeIds: ReadonlySet<string>;
	selectedNodeId: string | null;
}

export const defaultGraphVisualState: GraphVisualState = {
	activeNodeWeights: new Map<string, number>(),
	focusedOrganizationId: null,
	hoveredNodeId: null,
	selectedQuorumNodeIds: new Set<string>(),
	selectedNodeId: null
};

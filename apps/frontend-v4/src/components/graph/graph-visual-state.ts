export interface GraphVisualState {
	focusedOrganizationId: string | null;
	hoveredNodeId: string | null;
	selectedQuorumNodeIds: ReadonlySet<string>;
	selectedNodeId: string | null;
}

export const defaultGraphVisualState: GraphVisualState = {
	focusedOrganizationId: null,
	hoveredNodeId: null,
	selectedQuorumNodeIds: new Set<string>(),
	selectedNodeId: null
};

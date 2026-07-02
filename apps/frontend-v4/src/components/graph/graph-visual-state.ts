export interface GraphVisualState {
	focusedOrganizationId: string | null;
	hoveredNodeId: string | null;
	selectedNodeId: string | null;
}

export const defaultGraphVisualState: GraphVisualState = {
	focusedOrganizationId: null,
	hoveredNodeId: null,
	selectedNodeId: null
};

import type { Graph3DNode } from './model-3d';

export type GraphLinkEndpoint =
	Graph3DNode | number | string | { id?: number | string } | undefined;

export interface GraphLinkLike {
	label?: string;
	opacity?: number;
	relationship?: string;
	source?: GraphLinkEndpoint;
	target?: GraphLinkEndpoint;
}

export const getEndpointId = (endpoint: GraphLinkEndpoint): string | null => {
	if (endpoint === undefined) return null;
	if (typeof endpoint === 'string') return endpoint;
	if (typeof endpoint === 'number') return endpoint.toString();
	if (endpoint.id === undefined) return null;
	return endpoint.id.toString();
};

export const getGraphLinkKey = (link: GraphLinkLike): string => {
	const sourceId = getEndpointId(link.source) ?? '';
	const targetId = getEndpointId(link.target) ?? '';
	return `${sourceId}->${targetId}`;
};

import type { Graph3DNode } from './model-3d';

export const getCameraTarget = (
	node: Graph3DNode
): { x: number; y: number; z: number } => ({
	x: (node.x ?? 0) * 1.45,
	y: (node.y ?? 0) * 1.45,
	z: (node.z ?? 0) * 1.45 + 120
});

export const initialCameraPosition = { x: 0, y: -80, z: 940 };
export const initialCameraTarget = { x: 0, y: 0, z: 0 };

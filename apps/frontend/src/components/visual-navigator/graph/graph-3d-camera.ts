import type { Graph3DNode } from "@/components/visual-navigator/graph/graph-3d-data";

export interface Graph3DCameraVector {
  x: number;
  y: number;
  z: number;
}

export interface Graph3DCameraTarget {
  position: Graph3DCameraVector;
  lookAt: Graph3DCameraVector;
}

export function getInitialGraph3DCameraTarget(): Graph3DCameraTarget {
  return {
    position: { x: 220, y: 150, z: 360 },
    lookAt: { x: 0, y: 0, z: 0 },
  };
}

export function getGraph3DCameraTarget(
  nodes: Graph3DNode[],
): Graph3DCameraTarget | null {
  const positionedNodes = nodes.filter(
    (node): node is RequiredPositionNode =>
      !node.isPerimeter && hasNodePosition(node),
  );
  if (positionedNodes.length === 0) return null;

  const bounds = getBounds(positionedNodes);
  const lookAt = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const span = Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
    1,
  );
  const distance = Math.max(150, span * 1.05 + 56);

  return {
    position: {
      x: lookAt.x + distance * 0.72,
      y: lookAt.y + distance * 0.52,
      z: lookAt.z + distance,
    },
    lookAt,
  };
}

function getBounds(nodes: RequiredPositionNode[]) {
  return nodes.reduce(
    (bounds, node) => ({
      minX: Math.min(bounds.minX, node.x),
      maxX: Math.max(bounds.maxX, node.x),
      minY: Math.min(bounds.minY, node.y),
      maxY: Math.max(bounds.maxY, node.y),
      minZ: Math.min(bounds.minZ, node.z),
      maxZ: Math.max(bounds.maxZ, node.z),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  );
}

type RequiredPositionNode = Graph3DNode &
  Required<Pick<Graph3DNode, "x" | "y" | "z">>;

function hasNodePosition(node: Graph3DNode): node is RequiredPositionNode {
  return (
    Number.isFinite(node.x) &&
    Number.isFinite(node.y) &&
    Number.isFinite(node.z)
  );
}

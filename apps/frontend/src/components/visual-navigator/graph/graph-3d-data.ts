import type { LinkObject, NodeObject } from "3d-force-graph";
import ViewEdge from "@/components/visual-navigator/graph/view-edge";
import ViewGraph from "@/components/visual-navigator/graph/view-graph";
import ViewVertex from "@/components/visual-navigator/graph/view-vertex";

export interface Graph3DNode extends NodeObject {
  id: string;
  key: string;
  label: string;
  color: string;
  val: number;
  selected: boolean;
  isFailing: boolean;
  isPerimeter: boolean;
  isPartOfTransitiveQuorumSet: boolean;
  groupIndex: number;
}

export interface Graph3DLink extends LinkObject<Graph3DNode> {
  source: string | Graph3DNode;
  target: string | Graph3DNode;
  color: string;
  highlighted: boolean;
  isFailing: boolean;
  isPartOfStronglyConnectedComponent: boolean;
  isPartOfTransitiveQuorumSet: boolean;
}

export interface Graph3DData {
  nodes: Graph3DNode[];
  links: Graph3DLink[];
}

interface Graph3DDataOptions {
  showFailingEdges: boolean;
  transitiveQuorumSetOnly: boolean;
}

export function buildGraph3DData(
  viewGraph: ViewGraph,
  options: Graph3DDataOptions,
): Graph3DData {
  const visibleVertices = Array.from(viewGraph.viewVertices.values()).filter(
    (vertex) =>
      vertex.isPartOfTransitiveQuorumSet || !options.transitiveQuorumSetOnly,
  );
  const visibleKeys = new Set(visibleVertices.map((vertex) => vertex.key));
  const layout = getInitialLayout(visibleVertices);

  return {
    nodes: visibleVertices.map((vertex) => ({
      id: vertex.key,
      key: vertex.key,
      label: vertex.label,
      color: vertex.color,
      val: getNodeValue(vertex.isPartOfTransitiveQuorumSet, vertex.selected),
      groupIndex: vertex.groupIndex,
      selected: vertex.selected,
      isFailing: vertex.isFailing,
      isPerimeter: vertex.isPerimeter,
      isPartOfTransitiveQuorumSet: vertex.isPartOfTransitiveQuorumSet,
      ...getInitialPosition(vertex, layout),
    })),
    links: Array.from(viewGraph.viewEdges.values())
      .filter((edge) => includeEdge(edge, visibleKeys, options))
      .map((edge) => ({
        source: edge.parent,
        target: edge.child,
        color: edge.color,
        highlighted: edge.highlightAsTrusted || edge.highlightAsTrusting,
        isFailing: edge.isFailing,
        isPartOfStronglyConnectedComponent:
          edge.isPartOfStronglyConnectedComponent,
        isPartOfTransitiveQuorumSet: edge.isPartOfTransitiveQuorumSet,
      })),
  };
}

function includeEdge(
  edge: ViewEdge,
  visibleKeys: Set<string>,
  options: Graph3DDataOptions,
): boolean {
  if (!visibleKeys.has(edge.parent) || !visibleKeys.has(edge.child)) {
    return false;
  }

  if (edge.isFailing && !options.showFailingEdges) {
    return false;
  }

  return edge.isPartOfTransitiveQuorumSet || !options.transitiveQuorumSetOnly;
}

function getNodeValue(
  isPartOfTransitiveQuorumSet: boolean,
  selected: boolean,
): number {
  if (selected) return 9;
  return isPartOfTransitiveQuorumSet ? 7 : 4.5;
}

interface InitialLayout {
  centerX: number;
  centerY: number;
  scale: number;
}

function getInitialLayout(vertices: ViewVertex[]): InitialLayout {
  const anchorVertices = vertices.filter((vertex) => !vertex.isPerimeter);
  const layoutVertices = anchorVertices.length > 0 ? anchorVertices : vertices;
  const bounds = layoutVertices.reduce(
    (currentBounds, vertex) => ({
      minX: Math.min(currentBounds.minX, vertex.x),
      maxX: Math.max(currentBounds.maxX, vertex.x),
      minY: Math.min(currentBounds.minY, vertex.y),
      maxY: Math.max(currentBounds.maxY, vertex.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);

  return {
    centerX: bounds.minX + width / 2,
    centerY: bounds.minY + height / 2,
    scale: Math.max(width, height) / 320,
  };
}

function getInitialPosition(vertex: ViewVertex, layout: InitialLayout) {
  const x = (vertex.x - layout.centerX) / layout.scale;
  const y = (vertex.y - layout.centerY) / layout.scale;
  const z = getInitialDepth(vertex);
  if (!vertex.isPerimeter) return { x, y, z };

  return {
    x,
    y,
    z,
    fx: x,
    fy: y,
    fz: z,
  };
}

function getInitialDepth(vertex: ViewVertex): number {
  if (vertex.isPerimeter) {
    return Math.sin(vertex.groupIndex * 1.37) * 120;
  }

  if (vertex.isPartOfTransitiveQuorumSet) {
    return Math.sin(vertex.groupIndex * 1.19) * 34;
  }

  return Math.sin(vertex.groupIndex * 1.53) * 72;
}

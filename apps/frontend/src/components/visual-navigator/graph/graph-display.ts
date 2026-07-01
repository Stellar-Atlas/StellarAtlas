import type { Ref } from "vue";
import ViewEdge from "@/components/visual-navigator/graph/view-edge";
import ViewGraph from "@/components/visual-navigator/graph/view-graph";
import ViewVertex from "@/components/visual-navigator/graph/view-vertex";

export interface GraphDisplayContext {
  selectedVertices: Ref<ViewVertex[]>;
  viewGraph: Ref<ViewGraph>;
  optionHighlightTrustingNodes: Ref<boolean>;
  optionHighlightTrustedNodes: Ref<boolean>;
  optionShowFailingEdges: Ref<boolean>;
}

export function getVertexTransform(vertex: ViewVertex): string {
  return `translate(${vertex.x},${vertex.y})`;
}

export function getVertexRadius(vertex: ViewVertex): number {
  if (vertex.selected) return 13;
  if (vertex.isPartOfTransitiveQuorumSet) return 10;
  return 8.5;
}

export function getVertexStyle(vertex: ViewVertex): Record<string, string> {
  if (vertex.isFailing) return {};
  return { fill: vertex.color };
}

export function getEdgeStyle(edge: ViewEdge): Record<string, string> {
  return { "--edge-color": edge.color };
}

export function getVertexTextRectWidthPx(
  vertex: ViewVertex,
  truncate: (value: string, length: number) => string,
): string {
  return getVertexTextRectWidth(vertex, truncate) + "px";
}

export function getVertexTextRectX(
  vertex: ViewVertex,
  truncate: (value: string, length: number) => string,
): string {
  return "-" + getVertexTextRectWidth(vertex, truncate) / 2 + "px";
}

export function getVertexTextClass(
  vertex: ViewVertex,
): Record<string, boolean> {
  return {
    active: !vertex.isFailing,
    failing: vertex.isFailing,
    selected: vertex.selected,
  };
}

export function getVertexClassObject(
  vertex: ViewVertex,
  context: GraphDisplayContext,
): Record<string, boolean> {
  const highlightedIncoming = highlightVertexAsIncoming(vertex, context);

  return {
    active: !vertex.isFailing,
    selected: vertex.selected,
    failing: vertex.isFailing,
    target: highlightedIncoming && !vertex.selected,
    source:
      highlightVertexAsOutgoing(vertex, context) &&
      !vertex.selected &&
      !highlightedIncoming,
    transitive: vertex.isPartOfTransitiveQuorumSet,
  };
}

export function getEdgeClassObject(edge: ViewEdge): Record<string, boolean> {
  return {
    "strongly-connected": edge.isPartOfStronglyConnectedComponent,
    failing: edge.isFailing,
  };
}

export function getEdgePath(edge: ViewEdge): string {
  if (!isGraphEndpoint(edge.source))
    throw new Error("Edge source not transformed into object by D3");
  if (!isGraphEndpoint(edge.target))
    throw new Error("Edge target not transformed into object by D3");
  return `M${edge.source.x} ${edge.source.y} L${edge.target.x} ${edge.target.y}`;
}

function getVertexTextRectWidth(
  vertex: ViewVertex,
  truncate: (value: string, length: number) => string,
): number {
  return Math.max(36, truncate(vertex.label, 12).length * 5.5 + 8);
}

function highlightVertexAsOutgoing(
  vertex: ViewVertex,
  context: GraphDisplayContext,
): boolean {
  if (context.selectedVertices.value.length <= 0) return false;

  const edges = context.selectedVertices.value
    .map((selectedVertex) =>
      context.viewGraph.value.viewEdges.get(
        vertex.key + ":" + selectedVertex.key,
      ),
    )
    .filter((edge): edge is ViewEdge => edge !== undefined);
  if (edges.length <= 0) return false;

  return (
    vertex.isTrustingSelectedVertex &&
    context.optionHighlightTrustingNodes.value &&
    (!edges.every((edge) => edge.isFailing) ||
      context.optionShowFailingEdges.value)
  );
}

function highlightVertexAsIncoming(
  vertex: ViewVertex,
  context: GraphDisplayContext,
): boolean {
  if (context.selectedVertices.value.length <= 0) return false;

  const edges = context.selectedVertices.value
    .map((selectedVertex) =>
      context.viewGraph.value.viewEdges.get(
        selectedVertex.key + ":" + vertex.key,
      ),
    )
    .filter((edge): edge is ViewEdge => edge !== undefined);
  if (edges.length <= 0) return false;

  return (
    vertex.isTrustedBySelectedVertex &&
    context.optionHighlightTrustedNodes.value &&
    (!edges.every((edge) => edge.isFailing) ||
      context.optionShowFailingEdges.value)
  );
}

function isGraphEndpoint(
  endpoint: ViewVertex | string,
): endpoint is ViewVertex {
  return (
    typeof endpoint !== "string" &&
    Number.isFinite(endpoint.x) &&
    Number.isFinite(endpoint.y)
  );
}

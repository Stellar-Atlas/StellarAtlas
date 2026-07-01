import { TrustGraph, Vertex } from "shared";
import { getGraphGroupColor } from "@/components/visual-navigator/graph/graph-colors";

export default class ViewVertex {
  key: string;
  label: string;
  x = 0;
  y = 0;
  isPartOfTransitiveQuorumSet: boolean;
  isTrustingSelectedVertex = false;
  isTrustedBySelectedVertex = false;
  selected = false;
  isFailing = false;
  isPerimeter = false;
  groupKey: string | null = null;
  groupIndex = 0;
  color = getGraphGroupColor(null);

  constructor(
    key: string,
    label: string,
    isPartOfTransitiveQuorumSet: boolean,
    groupKey: string | null = null,
    groupIndex = 0,
  ) {
    this.key = key;
    this.label = label;
    this.isPartOfTransitiveQuorumSet = isPartOfTransitiveQuorumSet;
    this.groupKey = groupKey;
    this.groupIndex = groupIndex;
    this.color = getGraphGroupColor(groupKey);
  }

  static fromVertex(
    vertex: Vertex,
    trustGraph: TrustGraph,
    failingNodes: Set<string>,
    groupKey: string | null = null,
    groupIndex = 0,
  ) {
    const viewVertex = new ViewVertex(
      vertex.key,
      vertex.label,
      trustGraph.isVertexPartOfNetworkTransitiveQuorumSet(vertex.key),
      groupKey,
      groupIndex,
    );
    viewVertex.isFailing = failingNodes.has(vertex.key);

    return viewVertex;
  }

  static fromOrganization(
    vertex: Vertex,
    trustGraph: TrustGraph,
    failingOrganizations: Set<string>,
    groupIndex = 0,
  ) {
    const viewVertex = new ViewVertex(
      vertex.key,
      vertex.label,
      trustGraph.isVertexPartOfNetworkTransitiveQuorumSet(vertex.key),
      vertex.key,
      groupIndex,
    );
    viewVertex.isFailing = failingOrganizations.has(vertex.key);

    return viewVertex;
  }
}

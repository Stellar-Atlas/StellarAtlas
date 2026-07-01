import { Edge, TrustGraph } from "shared";
import type ViewVertex from "@/components/visual-navigator/graph/view-vertex";

export default class ViewEdge {
  key: string;
  source: ViewVertex | string; // key is replaced by object in d3.
  target: ViewVertex | string; // key is replaced by object in d3.
  parent: string;
  child: string;
  isPartOfStronglyConnectedComponent = false;
  isPartOfTransitiveQuorumSet = false;
  highlightAsTrusting = false;
  highlightAsTrusted = false;
  isFailing = false;
  color = "#9dbfd3";
  x?: number;
  y?: number;

  constructor(source: string, target: string) {
    this.source = source;
    this.target = target;
    this.parent = source;
    this.child = target;
    this.key = source + ":" + target;
  }

  protected static fromEdge(
    edge: Edge,
    trustGraph: TrustGraph,
    color = "#9dbfd3",
  ) {
    const viewEdge = new ViewEdge(edge.parent.key, edge.child.key);
    viewEdge.color = color;
    viewEdge.isPartOfStronglyConnectedComponent =
      trustGraph.isEdgePartOfStronglyConnectedComponent(edge);
    viewEdge.isPartOfTransitiveQuorumSet =
      trustGraph.isEdgePartOfNetworkTransitiveQuorumSet(edge);

    return viewEdge;
  }

  static fromNodeEdge(
    edge: Edge,
    trustGraph: TrustGraph,
    failingNodes: Set<string>,
    color?: string,
  ) {
    const viewEdge = ViewEdge.fromEdge(edge, trustGraph, color);
    if (failingNodes.has(edge.parent.key) || failingNodes.has(edge.child.key))
      viewEdge.isFailing = true;

    return viewEdge;
  }

  static fromOrganizationEdge(
    edge: Edge,
    trustGraph: TrustGraph,
    failingOrganizations: Set<string>,
    color?: string,
  ) {
    const viewEdge = ViewEdge.fromEdge(edge, trustGraph, color);

    if (
      failingOrganizations.has(edge.parent.key) ||
      failingOrganizations.has(edge.child.key)
    )
      viewEdge.isFailing = true;

    return viewEdge;
  }
}

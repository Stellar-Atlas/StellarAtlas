import type { ForceGraph3DInstance } from "3d-force-graph";
import type {
  Graph3DLink,
  Graph3DNode,
} from "@/components/visual-navigator/graph/graph-3d-data";

export function configureGraph3DForces(
  graph: ForceGraph3DInstance,
): ForceGraph3DInstance {
  graph
    .d3Force("charge")
    ?.strength((node: Graph3DNode) => getChargeStrength(node));
  graph
    .d3Force("link")
    ?.distance((link: Graph3DLink) => getLinkDistance(link))
    .strength((link: Graph3DLink) => getLinkStrength(link));

  return graph.d3AlphaDecay(0.028).d3VelocityDecay(0.36);
}

function getChargeStrength(node: Graph3DNode): number {
  if (node.isPerimeter) return -56;
  if (node.isPartOfTransitiveQuorumSet) return -185;
  return -112;
}

function getLinkDistance(link: Graph3DLink): number {
  if (isPerimeterLink(link)) return 210;
  if (link.isPartOfTransitiveQuorumSet) return 78;
  if (link.isPartOfStronglyConnectedComponent) return 104;
  return 132;
}

function getLinkStrength(link: Graph3DLink): number {
  if (isPerimeterLink(link)) return 0.006;
  if (link.isPartOfTransitiveQuorumSet) return 0.044;
  if (link.isPartOfStronglyConnectedComponent) return 0.018;
  return 0.004;
}

function isPerimeterLink(link: Graph3DLink): boolean {
  return isPerimeterNode(link.source) || isPerimeterNode(link.target);
}

function isPerimeterNode(node: string | Graph3DNode): boolean {
  return typeof node !== "string" && node.isPerimeter;
}

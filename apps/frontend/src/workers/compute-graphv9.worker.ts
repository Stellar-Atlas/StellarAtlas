import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import ViewVertex from "@/components/visual-navigator/graph/view-vertex";
import ViewEdge from "@/components/visual-navigator/graph/view-edge";

type GraphNodeDatum = ViewVertex & SimulationNodeDatum;
type GraphLinkDatum = ViewEdge & SimulationLinkDatum<GraphNodeDatum>;

type GraphWorkerPayload = {
  width: number;
  height: number;
  vertices: ViewVertex[];
  edges: ViewEdge[];
};

type GraphWorkerResponse = {
  type: "end";
  vertices: GraphNodeDatum[];
  edges: GraphLinkDatum[];
};

type GraphWorkerScope = {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<GraphWorkerPayload>) => void,
  ) => void;
  postMessage: (message: GraphWorkerResponse) => void;
};

const ctx = self as GraphWorkerScope;

ctx.addEventListener("message", (event: MessageEvent<GraphWorkerPayload>) => {
  const vertices = event.data.vertices as GraphNodeDatum[];
  const edges = event.data.edges as GraphLinkDatum[];
  const width = event.data.width;
  const height = event.data.height;

  const nrOfTransitiveVertices = Math.max(
    vertices.filter((vertex) => vertex.isPartOfTransitiveQuorumSet).length,
    1,
  );
  const nrOfGroups = Math.max(
    new Set(vertices.map((vertex) => vertex.groupIndex)).size,
    1,
  );
  const groupCenterRadius = Math.min(width, height) * 0.34;

  const simulation = forceSimulation<GraphNodeDatum>(vertices)
    .force(
      "charge",
      forceManyBody<GraphNodeDatum>().strength((vertex) => {
        return vertex.isPartOfTransitiveQuorumSet ? -520 : -310;
      }),
    )
    .force(
      "link",
      forceLink<GraphNodeDatum, GraphLinkDatum>(edges)
        .distance((edge) => {
          return edge.isPartOfTransitiveQuorumSet ? 82 : 140;
        })
        .strength((edge: SimulationLinkDatum<GraphNodeDatum>) => {
          const viewEdge = edge as GraphLinkDatum;
          if (viewEdge.isPartOfTransitiveQuorumSet) {
            return (1 / nrOfTransitiveVertices) * 0.17;
          } else if (viewEdge.isPartOfStronglyConnectedComponent) {
            return 0.1;
          } else {
            return 0.004;
          }
        })
        .id((vertex) => vertex.key),
    )
    .force(
      "x",
      forceX<GraphNodeDatum>(
        (vertex) =>
          groupCenter(vertex, nrOfGroups, width, height, groupCenterRadius).x,
      ).strength(0.08),
    )
    .force(
      "y",
      forceY<GraphNodeDatum>((vertex) =>
        groupCenter(vertex, nrOfGroups, width, height, groupCenterRadius).y,
      ).strength(0.08),
    )
    .force("center", forceCenter(width / 2, height / 2))
    .velocityDecay(0.38)
    .stop();

  for (
    let i = 0,
      n = Math.ceil(
        Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()),
      );
    i < n;
    ++i
  ) {
    //ctx.postMessage({type: 'tick', progress: i / n});
    simulation.tick();
  }
  ctx.postMessage({ type: "end", vertices: vertices, edges: edges });
});

function groupCenter(
  vertex: GraphNodeDatum,
  nrOfGroups: number,
  width: number,
  height = width,
  radius = Math.min(width, height) * 0.34,
): { x: number; y: number } {
  if (nrOfGroups <= 1) {
    return { x: width / 2, y: height / 2 };
  }

  const angle = (vertex.groupIndex / nrOfGroups) * Math.PI * 2;
  return {
    x: width / 2 + Math.cos(angle) * radius,
    y: height / 2 + Math.sin(angle) * radius,
  };
}

export default ctx;

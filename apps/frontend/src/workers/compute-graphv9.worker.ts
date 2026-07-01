import {
  forceCenter,
  forceCollide,
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

type LayoutBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type Point = {
  x: number;
  y: number;
};

const ctx = self as GraphWorkerScope;

ctx.addEventListener("message", (event: MessageEvent<GraphWorkerPayload>) => {
  const vertices = event.data.vertices as GraphNodeDatum[];
  const edges = event.data.edges as GraphLinkDatum[];
  const width = event.data.width;
  const height = event.data.height;
  const vertexByKey = new Map(vertices.map((vertex) => [vertex.key, vertex]));
  const layoutBounds = getLayoutBounds(width, height);
  const graphCenter = centerOf(layoutBounds);
  const degrees = getVertexDegrees(edges);
  const perimeterVertices = getPerimeterVertices(vertices, degrees);
  const perimeterVertexKeys = new Set(
    perimeterVertices.map((vertex) => vertex.key),
  );
  vertices.forEach((vertex) => {
    vertex.isPerimeter = perimeterVertexKeys.has(vertex.key);
  });
  const simulatedVertices = vertices.filter(
    (vertex) => !perimeterVertexKeys.has(vertex.key),
  );
  const simulatedEdges = edges.filter(
    (edge) =>
      !perimeterVertexKeys.has(endpointKey(edge.source)) &&
      !perimeterVertexKeys.has(endpointKey(edge.target)),
  );

  const nrOfTransitiveVertices = Math.max(
    simulatedVertices.filter((vertex) => vertex.isPartOfTransitiveQuorumSet)
      .length,
    1,
  );
  const nrOfGroups = Math.max(
    new Set(simulatedVertices.map((vertex) => vertex.groupIndex)).size,
    1,
  );
  const groupCenterRadius =
    Math.min(widthOf(layoutBounds), heightOf(layoutBounds)) * 0.43;

  const simulation = forceSimulation<GraphNodeDatum>(simulatedVertices)
    .force(
      "charge",
      forceManyBody<GraphNodeDatum>().strength((vertex) => {
        return vertex.isPartOfTransitiveQuorumSet ? -760 : -420;
      }),
    )
    .force(
      "link",
      forceLink<GraphNodeDatum, GraphLinkDatum>(simulatedEdges)
        .distance((edge) => {
          return edge.isPartOfTransitiveQuorumSet ? 112 : 170;
        })
        .strength((edge: SimulationLinkDatum<GraphNodeDatum>) => {
          const viewEdge = edge as GraphLinkDatum;
          if (viewEdge.isPartOfTransitiveQuorumSet) {
            return (1 / nrOfTransitiveVertices) * 0.2;
          } else if (viewEdge.isPartOfStronglyConnectedComponent) {
            return 0.11;
          } else {
            return 0.006;
          }
        })
        .id((vertex) => vertex.key),
    )
    .force(
      "collision",
      forceCollide<GraphNodeDatum>()
        .radius((vertex) => (vertex.isPartOfTransitiveQuorumSet ? 34 : 22))
        .strength(0.72)
        .iterations(2),
    )
    .force(
      "x",
      forceX<GraphNodeDatum>(
        (vertex) =>
          groupCenter(vertex, nrOfGroups, graphCenter, groupCenterRadius).x,
      ).strength(0.11),
    )
    .force(
      "y",
      forceY<GraphNodeDatum>(
        (vertex) =>
          groupCenter(vertex, nrOfGroups, graphCenter, groupCenterRadius).y,
      ).strength(0.11),
    )
    .force("center", forceCenter(graphCenter.x, graphCenter.y))
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
  fitVerticesToBounds(
    simulatedVertices,
    getSimulatedVertexBounds(layoutBounds, perimeterVertices.length),
  );
  placePerimeterVertices(perimeterVertices, layoutBounds);
  hydrateEdgeEndpoints(edges, vertexByKey);
  ctx.postMessage({ type: "end", vertices: vertices, edges: edges });
});

function groupCenter(
  vertex: GraphNodeDatum,
  nrOfGroups: number,
  center: Point,
  radius: number,
): { x: number; y: number } {
  if (nrOfGroups <= 1) {
    return center;
  }

  const angle = (vertex.groupIndex / nrOfGroups) * Math.PI * 2;
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function getLayoutBounds(width: number, height: number): LayoutBounds {
  const overlayMargin = width >= 992 ? Math.min(300, width * 0.24) : 24;

  return {
    left: overlayMargin + 30,
    right: Math.max(overlayMargin + 120, width - 36),
    top: 36,
    bottom: Math.max(160, height - 42),
  };
}

function getSimulatedVertexBounds(
  bounds: LayoutBounds,
  perimeterVertexCount: number,
): LayoutBounds {
  const perimeterPadding = perimeterVertexCount > 0 ? 34 : 40;

  return {
    left: bounds.left + 30,
    right: bounds.right - perimeterPadding,
    top: bounds.top + 30,
    bottom: bounds.bottom - Math.max(30, perimeterPadding),
  };
}

function centerOf(bounds: LayoutBounds): Point {
  return {
    x: bounds.left + widthOf(bounds) / 2,
    y: bounds.top + heightOf(bounds) / 2,
  };
}

function widthOf(bounds: LayoutBounds): number {
  return bounds.right - bounds.left;
}

function heightOf(bounds: LayoutBounds): number {
  return bounds.bottom - bounds.top;
}

function getVertexDegrees(edges: GraphLinkDatum[]): Map<string, number> {
  const degrees = new Map<string, number>();
  edges.forEach((edge) => {
    incrementDegree(degrees, endpointKey(edge.source));
    incrementDegree(degrees, endpointKey(edge.target));
  });

  return degrees;
}

function incrementDegree(degrees: Map<string, number>, key: string): void {
  degrees.set(key, (degrees.get(key) ?? 0) + 1);
}

function getPerimeterVertices(
  vertices: GraphNodeDatum[],
  degrees: Map<string, number>,
): GraphNodeDatum[] {
  if (vertices.length < 24) return [];

  return vertices
    .filter(
      (vertex) =>
        !vertex.isPartOfTransitiveQuorumSet &&
        (degrees.get(vertex.key) ?? 0) === 0,
    )
    .sort((first, second) => first.label.localeCompare(second.label));
}

function placePerimeterVertices(
  vertices: GraphNodeDatum[],
  bounds: LayoutBounds,
): void {
  if (vertices.length === 0) return;

  const columns = Math.max(8, Math.ceil(Math.sqrt(vertices.length)));
  const startX = bounds.right + 180;
  const startY = bounds.top + 48;
  const columnGap = 48;
  const rowGap = 38;

  vertices.forEach((vertex, index) => {
    vertex.x = startX + (index % columns) * columnGap;
    vertex.y = startY + Math.floor(index / columns) * rowGap;
  });
}

function fitVerticesToBounds(
  vertices: GraphNodeDatum[],
  bounds: LayoutBounds,
): void {
  if (vertices.length === 0) return;

  const extent = vertices.reduce(
    (currentExtent, vertex) => {
      return {
        left: Math.min(currentExtent.left, vertex.x ?? 0),
        right: Math.max(currentExtent.right, vertex.x ?? 0),
        top: Math.min(currentExtent.top, vertex.y ?? 0),
        bottom: Math.max(currentExtent.bottom, vertex.y ?? 0),
      };
    },
    {
      left: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );

  const extentWidth = Math.max(extent.right - extent.left, 1);
  const extentHeight = Math.max(extent.bottom - extent.top, 1);
  const scale = Math.min(
    widthOf(bounds) / extentWidth,
    heightOf(bounds) / extentHeight,
    1.08,
  );
  const targetCenter = centerOf(bounds);
  const extentCenter = {
    x: extent.left + extentWidth / 2,
    y: extent.top + extentHeight / 2,
  };

  vertices.forEach((vertex) => {
    vertex.x = targetCenter.x + ((vertex.x ?? 0) - extentCenter.x) * scale;
    vertex.y = targetCenter.y + ((vertex.y ?? 0) - extentCenter.y) * scale;
  });
}

function hydrateEdgeEndpoints(
  edges: GraphLinkDatum[],
  vertexByKey: Map<string, GraphNodeDatum>,
): void {
  edges.forEach((edge) => {
    edge.source = vertexByKey.get(endpointKey(edge.source)) ?? edge.source;
    edge.target = vertexByKey.get(endpointKey(edge.target)) ?? edge.target;
  });
}

function endpointKey(endpoint: string | GraphNodeDatum): string {
  return typeof endpoint === "string" ? endpoint : endpoint.key;
}

export default ctx;

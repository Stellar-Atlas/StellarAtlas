import { select, type Selection } from "d3-selection";
import {
  zoom,
  zoomIdentity,
  type D3ZoomEvent,
  type ZoomBehavior,
} from "d3-zoom";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";
import ViewEdge from "@/components/visual-navigator/graph/view-edge";
import ViewGraph from "@/components/visual-navigator/graph/view-graph";
import ViewVertex from "@/components/visual-navigator/graph/view-vertex";

export interface GraphControllerOptions {
  centerVertex: Ref<ViewVertex | null | undefined>;
  fullScreen: Ref<boolean>;
  zoomEnabled: Ref<boolean>;
  selectedVertices: Ref<ViewVertex[]>;
  viewGraph: Ref<ViewGraph>;
}

interface GraphWorkerResponse {
  type: string;
  vertices: ViewVertex[];
  edges: ViewEdge[];
}

export function useGraphController(options: GraphControllerOptions) {
  const graphSvg = ref<SVGElement | null>(null);
  const grid = ref<Element | null>(null);
  const isLoading = ref(true);

  let computeGraphWorker: Worker | null = null;
  let d3svg: Selection<Element, null, null, undefined> | null = null;
  let d3Grid: Selection<Element, null, null, undefined> | null = null;
  let graphZoom: ZoomBehavior<Element, null> | null = null;
  let resizeObserver: ResizeObserver | null = null;

  watch(options.centerVertex, () => {
    centerCorrectVertex();
  });

  watch(options.selectedVertices, () => {
    const selectedVertexKeys = options.selectedVertices.value.map(
      (vertex) => vertex.key,
    );
    options.viewGraph.value.reClassifyEdges(selectedVertexKeys);
    options.viewGraph.value.reClassifyVertices(selectedVertexKeys);
  });

  watch(options.viewGraph, () => {
    isLoading.value = true;
    postLayoutRequest();
  });

  watch(options.fullScreen, () => {
    postLayoutRequest();
    transformAndZoom();
    centerCorrectVertex();
  });

  watch(isLoading, () => {
    centerCorrectVertex();
  });

  const dimmerClass = computed(() => {
    return {
      dimmer: true,
      active: isLoading.value,
    };
  });

  onMounted(() => {
    const workerType = import.meta.env.DEV ? "module" : "classic";
    computeGraphWorker = new Worker(
      new URL("./../../../workers/compute-graphv9.worker.ts", import.meta.url),
      {
        type: workerType,
        /* @vite-ignore */
      },
    );
    computeGraphWorker.onmessage = (
      event: MessageEvent<GraphWorkerResponse>,
    ) => {
      if (event.data.type !== "end") return;

      mapViewGraph(event.data.vertices, event.data.edges);
      isLoading.value = false;
    };

    d3Grid = select(grid.value as Element);
    d3svg = select(graphSvg.value as Element);
    graphZoom = zoom<Element, null>()
      .filter((event: Event) => zoomEnabledFilter(event, options.zoomEnabled))
      .on("zoom", (event: D3ZoomEvent<Element, null>) => {
        d3Grid?.attr("transform", event.transform.toString());
      })
      .scaleExtent([0.35, 8]);

    transformAndZoom();
    observeGraphSize();
    postLayoutRequest();
  });

  onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    computeGraphWorker?.terminate();
  });

  function postLayoutRequest(): void {
    if (!computeGraphWorker || !graphSvg.value) return;

    computeGraphWorker.postMessage({
      width: width(),
      height: height(),
      vertices: Array.from(options.viewGraph.value.viewVertices.values()),
      edges: Array.from(options.viewGraph.value.viewEdges.values()),
    });
  }

  function centerCorrectVertex(): void {
    if (
      !(options.centerVertex.value instanceof ViewVertex) ||
      !d3svg ||
      !graphZoom
    )
      return;

    const realVertexX = -options.centerVertex.value.x + width() / 2;
    const realVertexY = -options.centerVertex.value.y + height() / 2;
    const transform = zoomIdentity.translate(realVertexX, realVertexY).scale(1);
    d3svg.call(graphZoom.transform, transform);
  }

  function mapViewGraph(vertices: ViewVertex[], edges: ViewEdge[]): void {
    vertices.forEach((updatedVertex) => {
      const vertex = options.viewGraph.value.viewVertices.get(
        updatedVertex.key,
      );
      if (!vertex) return;
      vertex.x = updatedVertex.x;
      vertex.y = updatedVertex.y;
      vertex.isPerimeter = updatedVertex.isPerimeter;
    });

    edges.forEach((updatedEdge) => {
      const edge = options.viewGraph.value.viewEdges.get(updatedEdge.key);
      if (!edge) return;
      edge.source = updatedEdge.source;
      edge.target = updatedEdge.target;
    });
  }

  function transformAndZoom(): void {
    if (!d3svg || !graphZoom) return;
    d3svg.call(graphZoom);
  }

  function observeGraphSize(): void {
    if (!graphSvg.value) return;

    resizeObserver = new ResizeObserver(() => {
      if (!isLoading.value) postLayoutRequest();
    });
    resizeObserver.observe(graphSvg.value);
  }

  function width(): number {
    return graphSvg.value?.clientWidth ?? 0;
  }

  function height(): number {
    return graphSvg.value?.clientHeight ?? 0;
  }

  return {
    dimmerClass,
    graphSvg,
    grid,
    isLoading,
  };
}

function zoomEnabledFilter(event: Event, zoomEnabled: Ref<boolean>): boolean {
  if (!zoomEnabled.value && event.type === "wheel") return false;
  return true;
}

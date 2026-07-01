<template>
  <div class="graph-3d-wrapper">
    <div v-if="isRendering" class="graph-3d-loader">
      <div class="loader"></div>
    </div>
    <div ref="container" class="graph-3d-canvas"></div>
  </div>
</template>

<script setup lang="ts">
import ForceGraph3D, {
  type ForceGraph3DInstance,
  type LinkObject,
  type NodeObject,
} from "3d-force-graph";
import SpriteText from "three-spritetext";
import {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  type Object3D,
} from "three";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRefs,
  watch,
  type PropType,
} from "vue";
import {
  buildGraph3DData,
  type Graph3DData,
  type Graph3DLink,
  type Graph3DNode,
} from "@/components/visual-navigator/graph/graph-3d-data";
import { getGraph3DCameraTarget, getInitialGraph3DCameraTarget } from "@/components/visual-navigator/graph/graph-3d-camera";
import { configureGraph3DForces } from "@/components/visual-navigator/graph/graph-3d-forces";
import ViewGraph from "@/components/visual-navigator/graph/view-graph";
import ViewVertex from "@/components/visual-navigator/graph/view-vertex";

type Graph3DNodeCandidate = NodeObject & Partial<Graph3DNode>;
type Graph3DLinkCandidate = LinkObject & Partial<Graph3DLink>;

const props = defineProps({
  centerVertex: {
    type: Object as PropType<ViewVertex>,
    required: false,
    default: null,
  },
  selectedVertices: {
    type: Array as PropType<ViewVertex[]>,
    required: true,
  },
  optionShowFailingEdges: {
    type: Boolean,
    required: true,
  },
  optionHighlightTrustingNodes: {
    type: Boolean,
    required: true,
  },
  optionHighlightTrustedNodes: {
    type: Boolean,
    required: true,
  },
  optionShowRegularEdges: {
    type: Boolean,
    required: true,
  },
  optionTransitiveQuorumSetOnly: {
    type: Boolean,
    required: true,
  },
  fullScreen: {
    type: Boolean,
    required: true,
  },
  zoomEnabled: {
    type: Boolean,
    required: true,
  },
  viewGraph: {
    type: Object as PropType<ViewGraph>,
    required: true,
  },
  isLoading: {
    type: Boolean,
    required: false,
    default: false,
  },
});

const {
  centerVertex,
  fullScreen,
  selectedVertices,
  optionShowFailingEdges,
  optionTransitiveQuorumSetOnly,
  viewGraph,
  zoomEnabled,
} = toRefs(props);
const emit = defineEmits(["vertex-selected"]);

const container = ref<HTMLElement | null>(null);
const isRendering = ref(true);
const graphData = computed(() =>
  buildGraph3DData(viewGraph.value, {
    showFailingEdges: optionShowFailingEdges.value,
    transitiveQuorumSetOnly: optionTransitiveQuorumSetOnly.value,
  }),
);

let graph: ForceGraph3DInstance | null = null;
let resizeObserver: ResizeObserver | null = null;
let fitTimeout: number | null = null;

watch(graphData, () => {
  updateGraphData();
});

watch(selectedVertices, () => {
  const selectedVertexKeys = selectedVertices.value.map((vertex) => vertex.key);
  viewGraph.value.reClassifyEdges(selectedVertexKeys);
  viewGraph.value.reClassifyVertices(selectedVertexKeys);
  updateGraphData();
});

watch(zoomEnabled, () => {
  graph?.enableNavigationControls(zoomEnabled.value);
});

watch(fullScreen, () => {
  resizeGraph();
  scheduleFit();
});

watch(centerVertex, () => {
  focusCenterVertex();
});

onMounted(() => {
  nextTick(() => {
    createGraph();
  });
});

onBeforeUnmount(() => {
  if (fitTimeout !== null) {
    window.clearTimeout(fitTimeout);
  }
  resizeObserver?.disconnect();
  graph?._destructor();
});

function createGraph(): void {
  if (!container.value) return;

  const nextGraph = new ForceGraph3D(container.value, {
    controlType: "orbit",
    rendererConfig: { antialias: true, alpha: false, preserveDrawingBuffer: true },
  })
    .backgroundColor("#fbfdff")
    .showNavInfo(false)
    .nodeId("id")
    .nodeVal((node) => readNode(node).val)
    .nodeColor((node) => getNodeColor(readNode(node)))
    .nodeThreeObject((node) => createNodeObject(readNode(node)))
    .linkColor((link) => getLinkColor(link))
    .linkOpacity(0.2)
    .linkWidth((link) => getLinkWidth(link))
    .linkDirectionalParticles((link) => (isHighlightedLink(link) ? 2 : 0))
    .linkDirectionalParticleWidth((link) => (isHighlightedLink(link) ? 2.2 : 0))
    .linkDirectionalParticleColor((link) => getLinkColor(link))
    .onNodeClick((node) => {
      const vertex = viewGraph.value.viewVertices.get(readNode(node).key);
      if (vertex) emit("vertex-selected", vertex);
    })
    .onEngineStop(() => {
      isRendering.value = false;
      scheduleFit();
    })
    .enableNavigationControls(zoomEnabled.value)
    .cooldownTicks(220)
    .graphData(graphData.value);

  graph = configureGraph3DForces(nextGraph);
  const initialCamera = getInitialGraph3DCameraTarget();
  nextGraph.cameraPosition(initialCamera.position, initialCamera.lookAt, 0);
  nextGraph.lights([
    new AmbientLight(0xffffff, 1.45),
    createDirectionalLight(180, 120, 160),
    createDirectionalLight(-160, -80, -140),
  ]);
  resizeGraph();
  observeSize();
  scheduleFit();
}

function updateGraphData(): void {
  if (!graph) return;

  isRendering.value = true;
  graph.graphData(graphData.value).d3ReheatSimulation();
  scheduleFit();
}

function createNodeObject(node: Graph3DNode): Object3D {
  const radius = getNodeRadius(node);
  const group = new Group();
  const material = new MeshLambertMaterial({
    color: getNodeColor(node),
    transparent: true,
    opacity: node.isPerimeter ? 0.62 : 0.96,
  });
  group.add(new Mesh(new SphereGeometry(radius, 16, 16), material));

  if (!node.isPerimeter) {
    const label = new SpriteText(
      getNodeLabel(node.label),
      node.isPartOfTransitiveQuorumSet ? 4.6 : 3.35,
      "#244d68",
    );
    label.backgroundColor = "rgba(255, 255, 255, 0.86)";
    label.borderRadius = 2;
    label.padding = [1, 3];
    label.fontWeight = "600";
    label.position.y = -(radius + 3.2);
    group.add(label);
  }

  return group;
}

function createDirectionalLight(x: number, y: number, z: number) {
  const light = new DirectionalLight(0xffffff, 0.86);
  light.position.set(x, y, z);
  return light;
}

function resizeGraph(): void {
  if (!graph || !container.value) return;

  const rect = container.value.getBoundingClientRect();
  graph.width(Math.max(1, Math.floor(rect.width)));
  graph.height(Math.max(1, Math.floor(rect.height)));
}

function observeSize(): void {
  if (!container.value) return;

  resizeObserver = new ResizeObserver(() => {
    resizeGraph();
  });
  resizeObserver.observe(container.value);
}

function scheduleFit(delay = 650): void {
  if (fitTimeout !== null) {
    window.clearTimeout(fitTimeout);
  }

  fitTimeout = window.setTimeout(() => {
    fitTimeout = null;
    const target = getGraph3DCameraTarget(graphData.value.nodes);
    if (target) {
      graph?.cameraPosition(target.position, target.lookAt, 650);
      return;
    }

    graph?.zoomToFit(650, 110, (node) => !readNode(node).isPerimeter);
  }, delay);
}

function focusCenterVertex(): void {
  if (!graph || !centerVertex.value) return;

  const graphNode = graphData.value.nodes.find(
    (node) => node.key === centerVertex.value?.key,
  );
  if (!graphNode || !hasCoordinates(graphNode)) return;

  graph.cameraPosition(
    {
      x: graphNode.x + 90,
      y: graphNode.y + 70,
      z: graphNode.z + 130,
    },
    { x: graphNode.x, y: graphNode.y, z: graphNode.z },
    650,
  );
}

function hasCoordinates(
  node: Graph3DNode,
): node is Graph3DNode & Required<Pick<Graph3DNode, "x" | "y" | "z">> {
  return (
    Number.isFinite(node.x) &&
    Number.isFinite(node.y) &&
    Number.isFinite(node.z)
  );
}

function getNodeRadius(node: Graph3DNode): number {
  if (node.selected) return 6.2;
  if (node.isPartOfTransitiveQuorumSet) return 5.3;
  if (node.isPerimeter) return 1.8;
  return 3.8;
}

function getNodeColor(node: Graph3DNode): string {
  if (node.isFailing) return "#d9534f";
  if (node.selected) return "#fec601";
  return node.color;
}

function readNode(node: NodeObject): Graph3DNode {
  const candidate = node as Graph3DNodeCandidate;
  const id = String(candidate.id ?? "node");
  const key = typeof candidate.key === "string" ? candidate.key : id;

  return {
    id,
    key,
    label: typeof candidate.label === "string" ? candidate.label : key,
    color: typeof candidate.color === "string" ? candidate.color : "#8f9aa7",
    val: typeof candidate.val === "number" ? candidate.val : 4.5,
    groupIndex:
      typeof candidate.groupIndex === "number" ? candidate.groupIndex : 0,
    selected: candidate.selected === true,
    isFailing: candidate.isFailing === true,
    isPerimeter: candidate.isPerimeter === true,
    isPartOfTransitiveQuorumSet: candidate.isPartOfTransitiveQuorumSet === true,
    x: candidate.x,
    y: candidate.y,
    z: candidate.z,
  };
}

function readLink(link: LinkObject): Graph3DLinkCandidate {
  return link as Graph3DLinkCandidate;
}

function getLinkColor(link: LinkObject): string {
  const candidate = readLink(link);
  if (candidate.isFailing) return "#d9534f";
  if (candidate.highlighted) return "#00a6a6";
  return typeof candidate.color === "string" ? candidate.color : "#9dbfd3";
}

function getLinkWidth(link: LinkObject): number {
  const candidate = readLink(link);
  if (candidate.highlighted) return 2.2;
  if (candidate.isPartOfStronglyConnectedComponent) return 1.15;
  return 0.5;
}

function isHighlightedLink(link: LinkObject): boolean {
  return readLink(link).highlighted === true;
}

function getNodeLabel(label: string): string {
  if (label.length <= 12) return label;
  return `${label.slice(0, 10)}...`;
}
</script>

<style scoped>
.graph-3d-wrapper {
  height: 100%;
  overflow: hidden;
  position: relative;
  background: #fbfdff;
}

.graph-3d-canvas {
  height: 100%;
  width: 100%;
}

.graph-3d-loader {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(251, 253, 255, 0.48);
}
</style>

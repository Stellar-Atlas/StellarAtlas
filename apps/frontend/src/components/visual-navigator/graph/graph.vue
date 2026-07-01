<template>
  <div :class="dimmerClass" style="height: 100%">
    <div class="loader"></div>
    <div class="dimmer-content svg-wrapper h-100">
      <svg
        ref="graphSvg"
        class="graph"
        xmlns="http://www.w3.org/2000/svg"
        width="100%"
        height="100%"
      >
        <g ref="grid">
          <g v-if="!isLoading && viewGraph">
            <path
              v-for="edge in viewGraph.regularEdges.filter(
                (mEdge) =>
                  (!mEdge.isFailing || optionShowFailingEdges) &&
                  (mEdge.isPartOfTransitiveQuorumSet ||
                    !optionTransitiveQuorumSetOnly),
              )"
              :id="edge.key"
              :key="edge.key"
              class="edge"
              :d="getEdgePath(edge)"
              :class="getEdgeClassObject(edge)"
              :style="getEdgeStyle(edge)"
            >
              <!-- Define the dot -->
            </path>
            <g v-if="propagationEnabled">
              <circle
                v-for="edge in viewGraph.regularEdges.filter(
                  (mEdge) =>
                    (!mEdge.isFailing || optionShowFailingEdges) &&
                    (mEdge.isPartOfTransitiveQuorumSet ||
                      !optionTransitiveQuorumSetOnly),
                )"
                :id="'propagation:' + edge.key"
                :key="'propagation:' + edge.key"
                visibility="hidden"
                r="5"
                class="propagation-circle"
              >
                <!-- Animate the dot along the path -->
                <animateMotion
                  begin="indefinite"
                  dur="1s"
                  repeatCount="1"
                  fill="freeze"
                >
                  <mpath :href="'#' + edge.key" />
                </animateMotion>
                <animate
                  id="radiusAnimation"
                  attributeName="r"
                  begin="indefinite"
                  dur="0.5s"
                  from="5"
                  to="10"
                />
              </circle>
            </g>
            <!-- Define the dot -->

            <path
              v-for="edge in viewGraph.stronglyConnectedEdges.filter(
                (mEdge) =>
                  (!mEdge.isFailing || optionShowFailingEdges) &&
                  (mEdge.isPartOfTransitiveQuorumSet ||
                    !optionTransitiveQuorumSetOnly),
              )"
              :key="edge.key"
              class="edge"
              :d="getEdgePath(edge)"
              :class="getEdgeClassObject(edge)"
              :style="getEdgeStyle(edge)"
            />
            <g
              v-if="
                selectedVertices &&
                selectedVertices.length > 0 &&
                optionHighlightTrustingNodes
              "
            >
              <path
                v-for="edge in viewGraph.trustingEdges.filter(
                  (mEdge) =>
                    (!mEdge.isFailing || optionShowFailingEdges) &&
                    (mEdge.isPartOfTransitiveQuorumSet ||
                      !optionTransitiveQuorumSetOnly),
                )"
                :key="edge.key + edge.key"
                class="edge incoming"
                :d="getEdgePath(edge)"
                :style="getEdgeStyle(edge)"
              />
            </g>
            <g
              v-if="
                selectedVertices &&
                selectedVertices.length > 0 &&
                optionHighlightTrustedNodes
              "
            >
              <path
                v-for="edge in viewGraph.trustedEdges.filter(
                  (mEdge) =>
                    (!mEdge.isFailing || optionShowFailingEdges) &&
                    (mEdge.isPartOfTransitiveQuorumSet ||
                      !optionTransitiveQuorumSetOnly),
                )"
                :key="edge.key + edge.key"
                class="edge outgoing"
                :d="getEdgePath(edge)"
                :style="getEdgeStyle(edge)"
              />
            </g>
            <graph-strongly-connected-component
              :greatest="true"
              :vertex-coordinates="viewGraph.transitiveQuorumSetCoordinates"
            />
            <g v-if="!optionTransitiveQuorumSetOnly">
              <graph-strongly-connected-component
                v-for="(
                  sccCoordinates, index
                ) in viewGraph.stronglyConnectedComponentCoordinates"
                :key="index"
                :vertex-coordinates="sccCoordinates"
              />
            </g>
            <g
              v-for="vertex in Array.from(
                viewGraph.viewVertices.values(),
              ).filter(
                (mVertex) =>
                  mVertex.isPartOfTransitiveQuorumSet ||
                  !optionTransitiveQuorumSetOnly,
              )"
              :key="vertex.key"
              :transform="getVertexTransform(vertex)"
              class="vertex"
              style="cursor: pointer"
              @click="
                vertexSelected(vertex);
                startPropagationAnimation(vertex.key);
              "
            >
              <circle
                :r="getVertexRadius(vertex)"
                :class="getVertexClassObject(vertex)"
                :style="getVertexStyle(vertex)"
              >
                <title>{{ vertex.label }}</title>
              </circle>
              <g>
                <rect
                  style="fill: white; opacity: 0.7; text-transform: lowercase"
                  :width="getVertexTextRectWidthPx(vertex)"
                  height="13px"
                  y="10"
                  :x="getVertexTextRectX(vertex)"
                  rx="2"
                  :class="{
                    'rect-selected': vertex.selected,
                    rect: !vertex.selected,
                  }"
                ></rect>
                <text
                  y="5"
                  :class="getVertexTextClass(vertex)"
                  dy="1.3em"
                  text-anchor="middle"
                  font-size="10px"
                >
                  {{ truncate(vertex.label, 12) }}
                  <title>{{ vertex.label }}</title>
                </text>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import GraphStronglyConnectedComponent from "@/components/visual-navigator/graph/graph-strongly-connected-component.vue";
import ViewVertex from "@/components/visual-navigator/graph/view-vertex";
import ViewGraph from "@/components/visual-navigator/graph/view-graph";
import { type PropType, toRefs } from "vue";
import { useTruncate } from "@/composables/useTruncate";
import {
  getEdgeClassObject,
  getEdgePath,
  getEdgeStyle,
  getVertexClassObject as buildVertexClassObject,
  getVertexRadius,
  getVertexStyle,
  getVertexTextClass,
  getVertexTextRectWidthPx as buildVertexTextRectWidthPx,
  getVertexTextRectX as buildVertexTextRectX,
  getVertexTransform,
  type GraphDisplayContext,
} from "@/components/visual-navigator/graph/graph-display";
import { startPropagationAnimation } from "@/components/visual-navigator/graph/graph-propagation";
import { useGraphController } from "@/components/visual-navigator/graph/use-graph-controller";

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
    default: false,
  },
  viewGraph: {
    type: Object as PropType<ViewGraph>,
    required: true,
  },
  initialZoom: {
    type: Number,
    required: false,
    default: 1,
  },
  propagationEnabled: {
    type: Boolean,
    required: false,
    default: false,
  },
});

const {
  centerVertex,
  fullScreen,
  zoomEnabled,
  selectedVertices,
  viewGraph,
  optionHighlightTrustingNodes,
  optionHighlightTrustedNodes,
  optionShowFailingEdges,
} = toRefs(props);
const emit = defineEmits(["vertex-selected"]);
const truncate = useTruncate();

const { dimmerClass, graphSvg, grid, isLoading } = useGraphController({
  centerVertex,
  fullScreen,
  zoomEnabled,
  selectedVertices,
  viewGraph,
});

function vertexSelected(vertex: ViewVertex) {
  emit("vertex-selected", vertex);
}

const graphDisplayContext: GraphDisplayContext = {
  selectedVertices,
  viewGraph,
  optionHighlightTrustingNodes,
  optionHighlightTrustedNodes,
  optionShowFailingEdges,
};

function getVertexClassObject(vertex: ViewVertex): Record<string, boolean> {
  return buildVertexClassObject(vertex, graphDisplayContext);
}

function getVertexTextRectWidthPx(vertex: ViewVertex): string {
  return buildVertexTextRectWidthPx(vertex, truncate);
}

function getVertexTextRectX(vertex: ViewVertex): string {
  return buildVertexTextRectX(vertex, truncate);
}
</script>

<style lang="scss" scoped src="./graph.scss"></style>

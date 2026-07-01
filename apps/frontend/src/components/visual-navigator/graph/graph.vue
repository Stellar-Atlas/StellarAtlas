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
            />
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
              :class="{
                'perimeter-vertex': vertex.isPerimeter,
                'secondary-vertex':
                  !vertex.isPartOfTransitiveQuorumSet && !vertex.selected,
              }"
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
              <g class="vertex-label">
                <rect
                  class="vertex-label-background"
                  :width="getVertexTextRectWidthPx(vertex)"
                  height="15px"
                  y="14"
                  :x="getVertexTextRectX(vertex)"
                  rx="3"
                  :class="{
                    'rect-selected': vertex.selected,
                    rect: !vertex.selected,
                  }"
                ></rect>
                <text
                  y="5"
                  :class="getVertexTextClass(vertex)"
                  dy="1.9em"
                  text-anchor="middle"
                  font-size="10.5px"
                >
                  {{ truncate(vertex.label, 14) }}
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
  getVertexStyle as buildVertexStyle,
  getVertexTextClass,
  getVertexTextRectWidthPx as buildVertexTextRectWidthPx,
  getVertexTextRectX as buildVertexTextRectX,
  getVertexTransform,
  type GraphDisplayContext,
} from "@/components/visual-navigator/graph/graph-display";
import { startPropagationAnimation } from "@/components/visual-navigator/graph/graph-propagation";
import { useGraphController } from "@/components/visual-navigator/graph/use-graph-controller";
import { useTrustVisualizationSettings } from "@/composables/useTrustVisualizationSettings";
import {
  TrustRankColorService,
  type TrustLevel,
} from "@/services/TrustRankColorService";
import { NodeTrustIndexService } from "@/services/NodeTrustIndexService";
import useStore from "@/store/useStore";

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
const { settings } = useTrustVisualizationSettings();

const { dimmerClass, graphSvg, grid, isLoading } = useGraphController({
  centerVertex,
  fullScreen,
  zoomEnabled,
  selectedVertices,
  viewGraph,
});

const graphDisplayContext: GraphDisplayContext = {
  selectedVertices,
  viewGraph,
  optionHighlightTrustingNodes,
  optionHighlightTrustedNodes,
  optionShowFailingEdges,
};

function vertexSelected(vertex: ViewVertex) {
  emit("vertex-selected", vertex);
}

function getTrustLevelForNode(publicKey: string): TrustLevel {
  try {
    const node = useStore().network.getNodeByPublicKey(publicKey);
    if (!node) return TrustRankColorService.getTrustLevel(null);

    return TrustRankColorService.getTrustLevel(
      NodeTrustIndexService.getTrustIndex(node),
    );
  } catch {
    return TrustRankColorService.getTrustLevel(null);
  }
}

function getVertexClassObject(vertex: ViewVertex): Record<string, boolean> {
  const baseClasses = buildVertexClassObject(vertex, graphDisplayContext);
  if (!settings.value.enabled || !vertex.key) return baseClasses;

  const trustLevel = getTrustLevelForNode(vertex.key);
  return {
    ...baseClasses,
    "trust-high": trustLevel.level === "high",
    "trust-medium": trustLevel.level === "medium",
    "trust-low": trustLevel.level === "low",
    "trust-unknown": trustLevel.level === "unknown",
  };
}

function getVertexStyle(vertex: ViewVertex): Record<string, string> {
  if (!settings.value.enabled || !vertex.key || vertex.isFailing)
    return buildVertexStyle(vertex);

  return {
    ...buildVertexStyle(vertex),
    fill: getTrustLevelForNode(vertex.key).color,
  };
}

function getVertexTextRectWidthPx(vertex: ViewVertex): string {
  return buildVertexTextRectWidthPx(vertex, truncate);
}

function getVertexTextRectX(vertex: ViewVertex): string {
  return buildVertexTextRectX(vertex, truncate);
}
</script>

<style lang="scss" scoped src="./graph.scss"></style>

<template>
  <div>
    <div class="page-header d-flex justify-content-between py-3">
      <div class="d-flex align-items-center">
        <h2 class="page-title">Network explorer</h2>
        <simulation-badge />
        <time-travel-badge />
        <div v-if="store.networkAnalyzer.analyzing">
          <div class="loader"></div>
        </div>
      </div>
      <crawl-time v-if="!store.isSimulation" />
    </div>
    <div
      v-if="selectedNode && selectedNode.unknown"
      class="alert alert-warning"
      role="alert"
    >
      Selected node with public key:
      <strong>{{
        selectedNode ? selectedNode.publicKey : "UNKNOWN PUBLIC KEY"
      }}</strong>
      is unknown or archived
    </div>

    <div
      v-if="selectedOrganization && selectedOrganization.unknown"
      class="alert alert-warning"
      role="alert"
    >
      Selected organization with id:
      <strong>{{ selectedOrganization.id }}</strong>
      is unknown or archived
    </div>

    <div
      v-if="
        store.isHaltingAnalysisVisible &&
        store.haltingAnalysisPublicKey &&
        !network.getNodeByPublicKey(store.haltingAnalysisPublicKey).unknown
      "
      id="halting-analysis-card"
      class="row row-cards row-deck"
    >
      <div class="col-12">
        <HaltingAnalysis
          :public-key="store.haltingAnalysisPublicKey ?? 'unknown'"
        >
        </HaltingAnalysis>
      </div>
    </div>
    <div class="dashboard-shell h-100">
      <aside class="dashboard-sidebar mb-5">
        <div class="card pt-0 sidebar-card h-100">
          <transition name="fade" mode="out-in">
            <router-view name="sideBar" class="h-100 side-bar" />
          </transition>
        </div>
      </aside>
      <div id="content" class="dashboard-content">
        <div class="row navigator-row">
          <div class="col">
            <network-visual-navigator :view="view" />
          </div>
        </div>
        <div
          v-if="store.isNetworkAnalysisVisible"
          id="network-analysis-card"
          class="row"
        >
          <div class="col-12">
            <network-analysis :dummy="'compiler_gives_error_if_no_props??'" />
          </div>
        </div>
        <div class="row">
          <div class="col-12">
            <router-view name="dashboard" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, watch } from "vue";
import HaltingAnalysis from "@/components/node/tools/halting-analysis/halting-analysis.vue";
import NetworkVisualNavigator from "@/components/visual-navigator/network-visual-navigator.vue";
import CrawlTime from "@/components/crawl-time.vue";
import SimulationBadge from "@/components/simulation-badge.vue";
import TimeTravelBadge from "@/components/time-travel-badge.vue";
import useStore from "@/store/useStore";
import { useRoute, useRouter } from "vue-router/composables";
import useScrollTo from "@/composables/useScrollTo";

const NetworkAnalysis = defineAsyncComponent(
  () =>
    import("@/components/network/tools/network-analysis/network-analysis.vue"),
);

defineProps({
  view: {
    type: String,
    required: true,
    default: "graph",
  },
});

const store = useStore();
const network = store.network;

const route = useRoute();
const router = useRouter();

const scrollTo = useScrollTo();

watch(
  route,
  (to) => {
    if (to.params.publicKey) {
      store.selectedNode = network.getNodeByPublicKey(to.params.publicKey);
      if (!store.selectedNode) {
        router.push({
          name: "network-dashboard",
          query: {
            view: route.query.view,
            network: route.query.network,
            at: route.query.at,
          },
        });
      }
    } else store.selectedNode = undefined;
    if (to.params.organizationId) {
      store.selectedOrganization = network.getOrganizationById(
        to.params.organizationId,
      );
      if (!store.selectedOrganization) {
        router.push({
          name: "network-dashboard",
          query: {
            view: route.query.view,
            network: route.query.network,
            at: route.query.at,
          },
        });
      }
    } else store.selectedOrganization = undefined;

    if (to.query.center === "1" || !to.query.center) {
      store.centerNode = store.selectedNode;
    }
  },
  { immediate: true },
);

const selectedNode = computed(() => store.selectedNode);
const selectedOrganization = computed(() => store.selectedOrganization);

const haltingAnalysisPublicKey = computed(() => {
  return store.haltingAnalysisPublicKey;
});

watch(haltingAnalysisPublicKey, (publicKey) => {
  if (publicKey) scrollTo("halting-analysis-card");
});
</script>

<style scoped>
.dashboard-shell {
  display: block;
  position: relative;
}

.dashboard-sidebar {
  width: 100%;
}

@media (min-width: 1279px) {
  .dashboard-sidebar {
    left: 0;
    margin-bottom: 0 !important;
    position: absolute;
    top: 0;
    width: 292px;
    z-index: 5;
  }

  .sidebar-card {
    backdrop-filter: blur(8px);
    background: rgba(255, 255, 255, 0.94);
    box-shadow: 0 12px 35px rgba(44, 62, 80, 0.12);
    height: min(88vh, 1040px) !important;
    max-height: 1040px;
    overflow: hidden;
  }

  .dashboard-content {
    max-width: 100%;
    width: 100%;
  }

  .navigator-row {
    margin-left: 0;
    margin-right: 0;
  }

  .navigator-row > .col {
    padding-left: 0;
    padding-right: 0;
  }

  .side-bar {
    width: 272px;
  }
}
</style>

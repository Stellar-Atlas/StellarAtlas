<template>
  <div class="card">
    <div class="card-header p-3">
      <h1 class="card-title">Latest updated validators</h1>
    </div>
    <div v-if="failed" class="card-alert alert alert-danger mb-0">
      <b-icon-exclamation-triangle />
      Error fetching data
    </div>
    <div :class="dimmerClass">
      <div class="loader mt-2"></div>
      <div class="dimmer-content">
        <b-list-group v-if="!isLoading" flush class="w-100 mb-4 card-columns">
          <b-list-group-item
            v-for="snapshot in snapshots"
            :key="snapshot.node.publicKey + snapshot.startDate"
            class="px-3 py-2"
          >
            <div class="text-muted mb-0" style="font-size: small">
              {{ snapshot.startDate.toLocaleString() }}
              <b-badge
                v-if="snapshot.startDate.getTime() === network.time.getTime()"
                variant="info"
                >current crawl</b-badge
              >
            </div>
            <div class="d-flex align-items-center justify-content-between ml-2">
              <div class="d-flex align-items-center">
                <div class="mr-1">
                  <router-link
                    :to="{
                      name: 'node-dashboard',
                      params: {
                        publicKey: snapshot.node.publicKey,
                      },
                      query: {
                        network: $route.query.network,
                        at: $route.query.at,
                      },
                    }"
                  >
                    {{ snapshot.node.displayName }}
                  </router-link>
                </div>
                <b-badge
                  v-if="
                    snapshot.startDate.getTime() ===
                    snapshot.node.dateDiscovered.getTime()
                  "
                  variant="success"
                  class="mr-1"
                  >New</b-badge
                >
              </div>
              <div class="d-flex align-items-center">
                <b-badge
                  :variant="getTrustBadgeVariant(snapshot.node)"
                  class="mr-1 trust-badge"
                  :title="`Trust: ${getTrustPercentage(snapshot.node)}`"
                >
                  {{ getTrustLevel(snapshot.node).label }}
                </b-badge>
                <div 
                  class="trust-indicator"
                  :style="{ backgroundColor: getTrustColor(snapshot.node) }"
                  :title="`Trust Level: ${getTrustPercentage(snapshot.node)}`"
                ></div>
              </div>
            </div>
          </b-list-group-item>
        </b-list-group>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import {
  BBadge,
  BIconExclamationTriangle,
  BListGroup,
  BListGroupItem,
} from "bootstrap-vue";
import { NodeSnapShot } from "shared";
import useStore from "@/store/useStore";
import { useIsLoading } from "@/composables/useIsLoading";
import { onMounted, type Ref, ref } from "vue";
import useNodeSnapshotRepository from "@/repositories/useNodeSnapshotRepository";
import { TrustRankColorService } from "@/services/TrustRankColorService";
import { NodeTrustIndexService } from "@/services/NodeTrustIndexService";

const store = useStore();
const nodeSnapshotRepository = useNodeSnapshotRepository();
const network = store.network;

const { isLoading, dimmerClass } = useIsLoading();

const failed = ref(false);
const snapshots: Ref<NodeSnapShot[]> = ref([]);

async function getSnapshots() {
  const result = await nodeSnapshotRepository.find(network.time);
  let snapshots: NodeSnapShot[] = [];
  if (result.isOk()) {
    snapshots = result.value;
  } else {
    failed.value = true;
  }
  isLoading.value = false;

  return snapshots;
}

// Trust-related functions
function getTrustLevel(node: any) {
  const trustIndex = NodeTrustIndexService.getTrustIndex(node);
  return TrustRankColorService.getTrustLevel(trustIndex);
}

function getTrustColor(node: any): string {
  const trustIndex = NodeTrustIndexService.getTrustIndex(node);
  return TrustRankColorService.getTrustColor(trustIndex);
}

function getTrustBadgeVariant(node: any): string {
  const trustIndex = NodeTrustIndexService.getTrustIndex(node);
  return TrustRankColorService.getTrustBadgeVariant(trustIndex);
}

function getTrustPercentage(node: any): string {
  const trustIndex = NodeTrustIndexService.getTrustIndex(node);
  return TrustRankColorService.formatTrustPercentage(trustIndex);
}

onMounted(async () => {
  snapshots.value = await getSnapshots();
});
</script>
<style scoped>
.card-columns {
  column-count: 3;
}

.trust-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.trust-badge {
  font-size: 0.7rem;
  min-width: 60px;
}
</style>

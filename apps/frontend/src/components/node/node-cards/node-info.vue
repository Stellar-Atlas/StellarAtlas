<template>
  <div class="card">
    <div class="card-body py-0 d-flex flex-column align-items-center">
      <h3 class="mt-5 mb-4 text-center d-flex align-items-start">
        <full-validator-title :node="node" />
        <b-badge
          v-show="network.isNodeFailing(node)"
          v-tooltip:top="network.getNodeFailingReason(node).description"
          variant="danger"
          class="ml-1"
          >{{ network.getNodeFailingReason(node).label }}</b-badge
        >
      </h3>
      <table class="table card-table">
        <thead>
          <tr>
            <th class="px-0"></th>
            <th class="px-0 text-right"></th>
          </tr>
        </thead>
        <tbody>
          <tr class="text-gray">
            <td class="px-0" style="font-weight: 600; font-size: 0.875rem">
              Public key
            </td>
            <td class="px-0 text-right">
              {{ node.publicKey.substring(0, 7) }}...{{
                node.publicKey.substring(51, 100)
              }}
              <button
                v-tooltip:top="'Copy to clipboard'"
                type="button"
                class="btn btn-sm btn-secondary"
                @click="copyPublicKey"
              >
                <b-icon-clipboard />
              </button>
            </td>
          </tr>
          <tr class="text-gray">
            <td class="px-0" style="font-weight: 600; font-size: 0.875rem">
              Network role
            </td>
            <td class="px-0 text-right">{{ nodeRole }}</td>
          </tr>
          <tr class="text-gray">
            <td class="px-0" style="font-weight: 600; font-size: 0.875rem">
              Consensus tier
            </td>
            <td class="px-0 text-right">{{ consensusTier }}</td>
          </tr>
          <tr class="text-gray">
            <td class="px-0" style="font-weight: 600; font-size: 0.875rem">
              host
            </td>
            <td class="px-0 text-right">{{ node.host }}</td>
          </tr>

          <tr class="text-gray">
            <td class="px-0" style="font-weight: 600; font-size: 0.875rem">
              ip:port
            </td>
            <td class="px-0 text-right">{{ node.key }}</td>
          </tr>
          <tr
            v-if="node.versionStr"
            v-tooltip:top="node.versionStr"
            class="text-gray"
          >
            <td class="px-0" style="font-weight: 600; font-size: 0.875rem">
              Version
            </td>
            <td class="px-0 text-right">
              {{ truncate(node.versionStr, 35) }}
            </td>
          </tr>
          <tr class="text-gray">
            <td class="px-0" style="font-weight: 600; font-size: 0.875rem">
              Country
            </td>
            <td class="px-0 text-right">
              {{ node.geoData.countryName ? node.geoData.countryName : "N/A" }}
            </td>
          </tr>
          <tr class="text-gray">
            <td class="px-0" style="font-weight: 600; font-size: 0.875rem">
              ISP
            </td>
            <td class="px-0 text-right">
              {{ node.isp ? node.isp : "N/A" }}
            </td>
          </tr>
          <tr class="text-gray">
            <td class="px-0" style="font-weight: 600; font-size: 0.875rem">
              Discovery date
            </td>
            <td class="px-0 text-right">
              {{ node.dateDiscovered.toDateString() }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
<script setup lang="ts">
import { Node } from "shared";
import { BBadge, BIconClipboard } from "bootstrap-vue";
import FullValidatorTitle from "@/components/node/full-validator-title.vue";
import useStore from "@/store/useStore";
import { useTruncate } from "@/composables/useTruncate";
import { computed } from "vue";

const store = useStore();
const network = store.network;
const props = defineProps<{
  node: Node;
}>();

const truncate = useTruncate();

const nodeRole = computed(() => {
  if (!props.node.isValidator) return "Listener node";
  if (!props.node.isValidating) return "Configured validator";
  if (props.node.isFullValidator) return "Full validator";
  return "Validator";
});

const consensusTier = computed(() => {
  if (!props.node.isValidator) {
    return props.node.active ? "Connectable listener" : "Inactive listener";
  }

  if (network.nodesTrustGraph.networkTransitiveQuorumSet.has(props.node.publicKey))
    return "Transitive quorum";

  if (props.node.activeInScp) return "SCP participant";

  return "Outside transitive quorum";
});

function copyPublicKey() {
  navigator.clipboard.writeText(props.node.publicKey);
}
</script>

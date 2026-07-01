<template>
  <div class="card">
    <div class="card-header pl-3">
      <h1 class="card-title">
        <b-badge variant="success">{{ numberOfActiveNodes }}</b-badge>
        active
        {{ store.includeAllNodes ? "nodes" : "validators" }}
      </h1>
      <div class="card-options">
        <form>
          <div class="input-group">
            <input
              v-model="filter"
              type="text"
              class="form-control form-control-sm"
              placeholder="Search"
              name="s"
            />
            <div class="input-icon-addon">
              <b-icon-search />
            </div>
          </div>
        </form>
      </div>
    </div>
    <nodes-table
      :filter="filter"
      :nodes="validators"
      :fields="fields"
      :per-page="5"
      :sort-by="'index'"
      :sort-by-desc="true"
    />
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import NodesTable, { type TableNode } from "@/components/node/nodes-table.vue";
import { BBadge, BIconSearch, type BvTableFieldArray } from "bootstrap-vue";
import useStore from "@/store/useStore";
import { Node } from "shared";

const store = useStore();
const network = store.network;

const filter = ref("");

const fields = computed(() => {
  const fields: BvTableFieldArray = [
    { key: "name", label: "Node", sortable: true },
  ];

  if (store.includeAllNodes) {
    fields.push({ key: "type", label: "Role", sortable: true });
  }

  if (store.networkContext.enableIndex && !store.isSimulation) {
    fields.push({ key: "index", label: "Index", sortable: true });
  }

  fields.push({
    key: "action",
    label: "",
    sortable: false,
    tdClass: "action",
  });

  return fields;
});

const numberOfActiveNodes = computed(() => {
  return activeNodes.value.length;
});

const activeNodes = computed(() => {
  return network.nodes.filter((node) => {
    if (store.includeAllNodes) return node.active;
    return node.isValidator && !network.isNodeFailing(node);
  });
});

const getNodeType = (node: Node): string => {
  if (!node.isValidator) return "Listener";
  if (!node.isValidating) return "Configured validator";
  if (node.isFullValidator) return "Full validator";
  return "Validator";
};

const validators = computed(() => {
  return activeNodes.value
    .map((node) => {
      const mappedNode: TableNode = {
        name: node.displayName,
        type: getNodeType(node),
        index: node.index,
        isFullValidator: node.isFullValidator,
        publicKey: node.publicKey,
        validating: node.isValidating,
      };
      return mappedNode;
    });
});
</script>

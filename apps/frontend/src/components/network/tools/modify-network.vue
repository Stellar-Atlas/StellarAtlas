<!-- eslint-disable vue/no-template-shadow -->
<template>
  <b-modal v-model="modalVisible" size="xl">
    <template #modal-header="{ close }">
      <h5 class="modal-title">Modify the network</h5>
      <!-- Emulate built in modal header close button action -->
      <button
        class="btn btn-sm btn-outline-default"
        aria-label="Close"
        @click="close()"
      >
        <b-icon-x />
      </button>
    </template>
    <template #default>
      <ul class="schema-list">
        <li>
          <a href="https://stellaratlas.io/schemas/network.json" target="_blank"
            >Network schema</a
          >
        </li>
        <li>
          <a href="https://stellaratlas.io/schemas/node.json" target="_blank"
            >Node schema</a
          >
        </li>
        <li>
          <a
            href="https://stellaratlas.io/schemas/organization.json"
            target="_blank"
            >Organization schema</a
          >
        </li>
      </ul>
      <b-form-textarea
        id="textarea"
        v-model="modifiedNetworkString"
        placeholder="Paste your custom network here"
        rows="20"
        max-rows="20"
        :state="modified ? null : isValid"
        @input="modified = true"
      ></b-form-textarea>
      <div v-if="!isValid" class="mt-2">
        <b-list-group>
          <b-list-group-item
            v-for="(error, index) in validationErrors"
            :key="index"
            variant="danger"
            >{{ formatErrorMessage(error) }}
          </b-list-group-item>
        </b-list-group>
      </div>
      <div class="mt-2">
        <button
          class="btn"
          @click="
            modifiedNetworkString = '';
            isValid = false;
            validationErrors = [];
          "
        >
          Clear
        </button>
        <button class="btn" @click="initModifiedNetworkString">Reset</button>
        <button class="btn" @click="copyJson">Copy JSON</button>
      </div>
    </template>
    <template #modal-footer="{ ok, cancel }">
      <button
        class="btn btn-secondary"
        @click="
          initModifiedNetworkString();
          cancel();
        "
      >
        Cancel
      </button>
      <button
        v-if="isValid && !modified"
        class="btn btn-success"
        @click="
          load();
          ok();
        "
      >
        Load network
      </button>
      <button v-else class="btn btn-primary" @click="validate">
        Validate JSON
      </button>
    </template>
  </b-modal>
</template>

<script setup lang="ts">
import {
  BFormTextarea,
  BIconX,
  BListGroup,
  BListGroupItem,
  BModal,
} from "bootstrap-vue";
import { Node, Organization, QuorumSet } from "shared";
import { ModifyNetwork as ModifyNetworkChange } from "@/services/change-queue/changes/modify-network";
import useStore from "@/store/useStore";
import { type Ref, ref } from "vue";
import validateNetworkSchema from "shared/lib/network-schema"; //we use network-schema because it is less strict then the dto/generated validation scripts

type BasicQuorumSet = {
  validators: string[];
  threshold: number;
  innerQuorumSets: BasicQuorumSet[];
};

type BasicOrganization = {
  id: string;
  name: string;
  validators: string[];
  subQuorumAvailable?: boolean;
};

type BasicNode = {
  publicKey: string;
  name: string;
  quorumSet: BasicQuorumSet;
  geoData: {
    countryCode: string;
    countryName: string;
  };
  isp: string;
  isValidating?: boolean;
  active?: boolean;
};

type ValidationError = {
  dataPath?: string;
  message?: string;
  params: unknown;
};

const store = useStore();

const modalVisible = ref(false);
const modifiedNetworkString = ref("");

const formatErrorMessage = (error: ValidationError) => {
  let message = error.message;
  if (error.dataPath) {
    message += " at " + error.dataPath;
  }
  if (error.params && typeof error.params === "object") {
    message += " ( " + Object.values(error.params as string[])[0] + " ) ";
  }
  return message;
};

let modifiedNetwork: {
  nodes: BasicNode[];
  organizations: BasicOrganization[];
} = { nodes: [], organizations: [] };
const isValid = ref(false);
const modified = ref(false);
const validationErrors: Ref<ValidationError[]> = ref([]);

const showModal = () => {
  initModifiedNetworkString();
  modalVisible.value = true;
};

const validate = () => {
  isValid.value = false;
  modified.value = false;
  try {
    modifiedNetwork = JSON.parse(modifiedNetworkString.value);
    isValid.value = validateNetworkSchema(modifiedNetwork);
    validationErrors.value = validateNetworkSchema.errors;
  } catch (error) {
    if (error instanceof Error)
      validationErrors.value = [
        {
          message: error.message,
          dataPath: undefined,
          params: undefined,
        },
      ];
  }
};

const load = () => {
  const nodesMap = new Map<string, Node>();
  const nodes = modifiedNetwork.nodes.map((basicNode) => {
    const node = new Node(basicNode.publicKey);
    node.geoData.countryCode = basicNode.geoData.countryCode;
    node.geoData.countryName = basicNode.geoData.countryName;
    node.isp = basicNode.isp;
    node.name = basicNode.name;
    node.quorumSet = QuorumSet.fromBaseQuorumSet(basicNode.quorumSet);
    node.isValidating =
      basicNode.isValidating === undefined ? true : basicNode.isValidating;
    node.active = basicNode.active === undefined ? true : basicNode.active;

    nodesMap.set(node.publicKey, node);
    return node;
  });
  let organizations: Organization[] = [];
  if (modifiedNetwork.organizations) {
    organizations = modifiedNetwork.organizations.map((basicOrganization) => {
      const organization = new Organization(
        basicOrganization.id,
        basicOrganization.name,
      );
      organization.validators = basicOrganization.validators;
      organization.validators.forEach((validatorPublicKey) => {
        const validator = nodesMap.get(validatorPublicKey);
        if (!validator) return;

        validator.organizationId = organization.id;
      });
      organization.subQuorumAvailable =
        basicOrganization.subQuorumAvailable === undefined
          ? true
          : basicOrganization.subQuorumAvailable;
      return organization;
    });
  }

  store.processChange(
    new ModifyNetworkChange(store.network, nodes, organizations),
  );
};

const mapToBasicQuorumSet = (quorumSet: QuorumSet): BasicQuorumSet => {
  return {
    threshold: quorumSet.threshold,
    validators: quorumSet.validators,
    innerQuorumSets: quorumSet.innerQuorumSets.map((innerQSet) =>
      mapToBasicQuorumSet(innerQSet),
    ),
  };
};

const mapToBasicNode = (node: Node): BasicNode => {
  return {
    publicKey: node.publicKey,
    name: node.displayName,
    quorumSet: mapToBasicQuorumSet(node.quorumSet),
    geoData: {
      countryCode: node.geoData.countryCode ? node.geoData.countryCode : "N/A",
      countryName: node.geoData.countryName ? node.geoData.countryName : "N/A",
    },
    isp: node.isp ? node.isp : "N/A",
    active: node.active,
    isValidating: node.isValidating,
  };
};

const mapToBasicOrganization = (
  organization: Organization,
): BasicOrganization => {
  return {
    id: organization.id,
    name: organization.name,
    validators: organization.validators,
    subQuorumAvailable: organization.subQuorumAvailable,
  };
};

const initModifiedNetworkString = () => {
  modifiedNetwork = {
    nodes: store.network.nodes
      .filter((node) => node.isValidator)
      .map((node) => mapToBasicNode(node)),
    organizations: store.network.organizations.map((organization) =>
      mapToBasicOrganization(organization),
    ),
  };
  modifiedNetworkString.value = JSON.stringify(modifiedNetwork, null, 2);
  isValid.value = true;
};

function copyJson() {
  navigator.clipboard.writeText(modifiedNetworkString.value);
}

defineExpose({
  showModal,
});
</script>

<style scoped>
.schema-list {
  padding-left: 0;
  list-style-type: none;
}
</style>

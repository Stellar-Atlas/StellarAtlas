import {
  Network,
  Node,
  Organization,
  QuorumSet,
  QuorumSetService,
} from "shared";
import {
  type NetworkChange,
  NetworkChangeQueue,
} from "@/services/change-queue/network-change-queue";
import { EntityPropertyUpdate } from "@/services/change-queue/changes/entity-property-update";
import { QuorumSetValidatorDelete } from "@/services/change-queue/changes/quorum-set-validator-delete";
import { InnerQuorumSetDelete } from "@/services/change-queue/changes/inner-quorum-set-delete";
import { InnerQuorumSetAdd } from "@/services/change-queue/changes/inner-quorum-set-add";
import { QuorumSetValidatorsAdd } from "@/services/change-queue/changes/quorum-set-validators-add";
import { NetworkAddNode } from "@/services/change-queue/changes/network-add-node";
import { reactive, type UnwrapNestedRefs } from "vue";
import { QuorumSetOrganizationsAdd } from "@/services/change-queue/changes/quorum-set-organizations-add";
import { AggregateChange } from "@/services/change-queue/changes/aggregate-change";
import NetworkAnalyzer from "@/services/NetworkAnalyzer";
import { MergeBy } from "@stellarobserver/stellar_analysis_web";
import { isString } from "shared";
import Config, { type NetworkContext, type NetworkId } from "@/config/Config";

interface Data {
  isLoading: boolean;
  network: Network | null;
  networkChangeQueue: NetworkChangeQueue | null;
  networkAnalyzer: NetworkAnalyzer | null;
  selectedNode?: Node;
  centerNode?: Node;
  uniqueId: number;
  isHaltingAnalysisVisible: boolean;
  haltingAnalysisPublicKey?: string;
  fetchingDataFailed: boolean;
  measurementsStartDate: Date;
  networkReCalculated: number; //to update graph views in one go, instead on every individual network change
  isNetworkAnalysisVisible: boolean;
  isTimeTravel: boolean;
  networkAnalysisMergeBy: MergeBy;
  timeTravelDate?: Date;
  includeAllConnectableNodes: boolean;
  selectedOrganization?: Organization;
  latestTermsChangeTimestamp: number;
}

export default class Store {
  public networkContext: NetworkContext;
  public allNodesFilter = (node: Node) => {
    return this.includeAllNodes || node.isValidator;
  };

  public networkContexts: Map<NetworkId, NetworkContext> = new Map();

  //todo: move higher up
  public appConfig: Config;
  private defaultNetworkId = "public";

  private data: UnwrapNestedRefs<Data> = reactive<Data>({
    isLoading: true,
    network: null,
    networkChangeQueue: null,
    networkAnalyzer: null,
    selectedNode: undefined,
    centerNode: undefined,
    uniqueId: 0,
    isHaltingAnalysisVisible: false,
    haltingAnalysisPublicKey: undefined,
    fetchingDataFailed: false,
    measurementsStartDate: new Date("2019-06-01"),
    networkReCalculated: 0,
    isNetworkAnalysisVisible: false,
    isTimeTravel: false,
    networkAnalysisMergeBy: MergeBy.DoNotMerge,
    timeTravelDate: undefined,
    includeAllConnectableNodes: false,
    selectedOrganization: undefined,
    latestTermsChangeTimestamp: new Date("2023-01-01").getTime(), //todo: better location
  });

  //todo: networkContext should be injected?
  constructor() {
    //todo: inject
    const appConfig = new Config();
    this.networkContexts = appConfig.networkContexts;
    const networkContext = this.networkContexts.get(this.defaultNetworkId);
    if (!networkContext) throw new Error("No default network context found");
    this.networkContext = networkContext;
    if (!this.networkContext.apiBaseUrl)
      throw new Error("No api base url found");
    this.appConfig = appConfig;
  }

  get latestTermsChangeTimestamp(): number {
    return this.data.latestTermsChangeTimestamp;
  }

  get isLoading(): boolean {
    return this.data.isLoading;
  }

  set isLoading(value: boolean) {
    this.data.isLoading = value;
  }

  set isTimeTravel(value: boolean) {
    this.data.isTimeTravel = value;
  }

  get isTimeTravel(): boolean {
    return this.data.isTimeTravel;
  }

  set timeTravelDate(value: Date | undefined) {
    this.data.timeTravelDate = value;
  }

  get timeTravelDate(): Date | undefined {
    return this.data.timeTravelDate;
  }

  get networkAnalysisMergeBy(): MergeBy {
    return this.data.networkAnalysisMergeBy;
  }

  set networkAnalysisMergeBy(value: MergeBy) {
    this.data.networkAnalysisMergeBy = value;
  }

  get isNetworkAnalysisVisible(): boolean {
    return this.data.isNetworkAnalysisVisible;
  }

  set isNetworkAnalysisVisible(value: boolean) {
    this.data.isNetworkAnalysisVisible = value;
  }
  get networkReCalculated(): number {
    return this.data.networkReCalculated;
  }

  set selectedNode(node: Node | undefined) {
    this.data.selectedNode = node;
  }

  get selectedNode(): Node | undefined {
    return this.data.selectedNode;
  }

  set selectedOrganization(organization: Organization | undefined) {
    this.data.selectedOrganization = organization;
  }

  get selectedOrganization(): Organization | undefined {
    return this.data.selectedOrganization;
  }

  set centerNode(node: Node | undefined) {
    this.data.centerNode = node;
  }

  get centerNode(): Node | undefined {
    return this.data.centerNode;
  }

  get measurementsStartDate(): Date {
    return this.data.measurementsStartDate;
  }

  get includeAllNodes(): boolean {
    return this.data.includeAllConnectableNodes;
  }

  //used in v-model
  set includeAllNodes(value: boolean) {
    this.data.includeAllConnectableNodes = value;
  }

  get network(): Network {
    if (!this.data.network) throw new Error("Network not loaded correctly");

    return <Network>this.data.network;
  }

  //@deprecated
  get isLocalNetwork(): boolean {
    return !this.networkContext.enableHistory;
  }

  //@deprecated
  get networkId(): string {
    return this.networkContext.networkId;
  }

  get fetchingDataFailed(): boolean {
    return this.data.fetchingDataFailed;
  }

  set fetchingDataFailed(value: boolean) {
    this.data.fetchingDataFailed = value;
  }

  getNetworkContextFromNetworkId(
    networkId: string | null,
  ): NetworkContext | null {
    const targetNetworkId =
      networkId === null ? this.defaultNetworkId : networkId;
    return this.networkContexts.get(targetNetworkId) ?? null;
  }

  networkNeedsToBeUpdated(
    networkId: string | null,
    at: Date | undefined,
  ): boolean {
    const targetNetworkContext = this.getNetworkContextFromNetworkId(networkId);
    if (targetNetworkContext === null) return false; //unknown network

    if (targetNetworkContext.networkId !== this.networkContext.networkId)
      return true; //new network context

    return this.timeTravelDate?.getTime() !== at?.getTime(); //new time travel date
  }

  async updateNetwork(networkId: string | null, at: Date | undefined) {
    const newNetworkContext = this.getNetworkContextFromNetworkId(networkId);
    if (newNetworkContext) {
      this.networkContext = newNetworkContext;
      return await this.fetchNetwork(at);
    }
  }

  protected setNetwork(network: Network) {
    this.data.network = network;
    this.data.networkAnalyzer = new NetworkAnalyzer(this.network);
    this.data.networkChangeQueue = new NetworkChangeQueue(
      this.network,
      this.networkAnalyzer,
    );
    this.data.networkReCalculated++;
  }

  get changeQueue(): NetworkChangeQueue {
    if (!this.data.networkChangeQueue) {
      throw new Error("Network not loaded correctly");
    }

    return <NetworkChangeQueue>this.data.networkChangeQueue;
  }

  get networkAnalyzer(): NetworkAnalyzer {
    if (!this.data.networkAnalyzer) {
      throw new Error("Network not loaded correctly");
    }

    return <NetworkAnalyzer>this.data.networkAnalyzer;
  }

  public getNetworkContextName(networkId?: NetworkId): string | undefined {
    if (!networkId) return this.networkContext.name;
    const context = this.networkContexts.get(networkId);
    return context?.name;
  }

  getUniqueId() {
    return this.data.uniqueId++;
  }

  public showHaltingAnalysis(node: Node) {
    this.data.isHaltingAnalysisVisible = true;
    this.data.haltingAnalysisPublicKey = node.publicKey;
  }

  get isHaltingAnalysisVisible(): boolean {
    return this.data.isHaltingAnalysisVisible;
  }

  set isHaltingAnalysisVisible(value: boolean) {
    this.data.isHaltingAnalysisVisible = value;
  }

  get haltingAnalysisPublicKey() {
    return this.data.haltingAnalysisPublicKey;
  }

  private async fetchNetwork(at?: Date): Promise<void> {
    this.fetchingDataFailed = false;

    if (at) {
      this.isTimeTravel = true;
      this.timeTravelDate = at;
    } else {
      this.isTimeTravel = false;
      this.timeTravelDate = undefined;
    }

    this.isLoading = true;
    const networkResult = await this.networkContext.repository.find(at);

    if (networkResult.isOk()) {
      this.setNetwork(networkResult.value);
      this.isLoading = false;
      return;
    }
    this.fetchingDataFailed = true;
    this.isLoading = false;
  }

  public toggleOrganizationAvailability(organization: Organization) {
    const targetAvailability = !organization.subQuorumAvailable;
    const aggregateChange = new AggregateChange([
      new EntityPropertyUpdate(
        organization,
        "subQuorumAvailable",
        targetAvailability,
      ),
      ...organization.validators.map((validator) => {
        const node = this.network.getNodeByPublicKey(validator);
        return new EntityPropertyUpdate(
          node,
          "isValidating",
          targetAvailability,
        );
      }),
      ...organization.validators.map((validator) => {
        const node = this.network.getNodeByPublicKey(validator);
        return new EntityPropertyUpdate(
          node,
          "activeInScp",
          targetAvailability,
        );
      }),
    ]);
    this.processChange(aggregateChange);
  }

  public toggleValidating(node: Node) {
    const changes: NetworkChange[] = [];
    if (!node.active)
      changes.push(new EntityPropertyUpdate(node, "active", !node.active));

    changes.push(
      new EntityPropertyUpdate(node, "isValidating", !node.isValidating),
    );

    changes.push(
      new EntityPropertyUpdate(node, "activeInScp", !node.isValidating),
    );

    this.processChange(new AggregateChange(changes));
  }

  public editQuorumSetThreshold(quorumSet: QuorumSet, newThreshold: number) {
    if (quorumSet.threshold === newThreshold) {
      return;
    }

    this.processChange(
      new EntityPropertyUpdate(quorumSet, "threshold", newThreshold),
    );
  }

  public deleteValidatorFromQuorumSet(quorumSet: QuorumSet, validator: Node) {
    this.processChange(
      new QuorumSetValidatorDelete(quorumSet, validator.publicKey),
    );
  }

  public deleteInnerQuorumSet(quorumSet: QuorumSet, fromQuorumSet: QuorumSet) {
    this.processChange(new InnerQuorumSetDelete(fromQuorumSet, quorumSet));
  }

  public addInnerQuorumSet(toQuorumSet: QuorumSet) {
    this.processChange(new InnerQuorumSetAdd(toQuorumSet));
  }

  public addValidators(toQuorumSet: QuorumSet, validators: string[]) {
    this.processChange(new QuorumSetValidatorsAdd(toQuorumSet, validators));
  }

  public addOrganizations(
    toQuorumSet: QuorumSet,
    organizations: Organization[],
  ) {
    this.processChange(
      new QuorumSetOrganizationsAdd(toQuorumSet, organizations),
    );
  }

  public removeOrganizationFromOrganization(
    organization: Organization,
    fromOrganization: Organization,
  ) {
    const fromNodes = fromOrganization.validators.map((publicKey) =>
      this.network.getNodeByPublicKey(publicKey),
    );

    const changes: NetworkChange[] = [];
    fromNodes.forEach((node) => {
      node.quorumSet.innerQuorumSets.forEach((qSet) => {
        if (
          QuorumSetService.isOrganizationQuorumSet(qSet, this.network) &&
          this.network.getNodeByPublicKey(qSet.validators[0]).organizationId ===
            organization.id
        ) {
          changes.push(new InnerQuorumSetDelete(node.quorumSet, qSet));
          changes.push(
            new EntityPropertyUpdate(
              node.quorumSet,
              "threshold",
              node.quorumSet.threshold - 1,
            ),
          );
        }
      });
    });

    this.processChange(new AggregateChange(changes));
  }

  public addOrganizationsToOrganization(
    organizations: Organization[],
    toOrganization: Organization,
  ) {
    const toNodes = toOrganization.validators.map((publicKey) =>
      this.network.getNodeByPublicKey(publicKey),
    );

    const changes: NetworkChange[] = [];
    toNodes.forEach((node) => {
      changes.push(
        new QuorumSetOrganizationsAdd(node.quorumSet, organizations),
      );
      changes.push(
        new EntityPropertyUpdate(
          node.quorumSet,
          "threshold",
          node.quorumSet.threshold + 1,
        ),
      );
    });

    this.processChange(new AggregateChange(changes));
  }

  public processChange(change: NetworkChange) {
    this.changeQueue.execute(change);
    this.data.networkReCalculated++;
  }

  get isSimulation(): boolean {
    return this.changeQueue.hasUndo() || this.networkContext.isSimulation;
  }

  get hasUndo(): boolean {
    return this.changeQueue.hasUndo();
  }

  get hasRedo(): boolean {
    return this.changeQueue.hasRedo();
  }

  public undoUpdate() {
    if (!this.changeQueue.hasUndo()) {
      return;
    }
    this.changeQueue.undo();
    this.data.networkReCalculated++;
  }

  public redoUpdate() {
    if (!this.changeQueue.hasRedo()) {
      return;
    }
    this.changeQueue.redo();
    this.data.networkReCalculated++;
  }

  public addNodeToNetwork(node: Node) {
    this.changeQueue.execute(new NetworkAddNode(this.network, node));
    this.data.networkReCalculated++;
  }

  public resetUpdates() {
    if (!this.changeQueue.hasUndo()) {
      return;
    }
    this.changeQueue.reset();
    this.data.networkReCalculated++;
  }

  //todo: needs better location
  getOrganizationFailingReason(organization: Organization) {
    if (this.network.isOrganizationBlocked(organization)) {
      return "Organization blocked: Validators not reaching quorumSet thresholds";
    } else {
      return "More then 50% of its validators are failing";
    }
  }

  getOrganizationFailAt(organization: Organization) {
    const nrOfValidatingNodes = organization.validators
      .map((validator) => this.network.getNodeByPublicKey(validator))
      .filter((node) => !this.network.isNodeFailing(node)).length;

    return nrOfValidatingNodes - organization.subQuorumThreshold + 1;
  }

  getNetworkWarnings(): { label: string; description: string } {
    if (this.network.networkStatistics.minBlockingSetFilteredSize <= 2) {
      return {
        label: "Liveness risk",
        description:
          this.network.networkStatistics.minBlockingSetFilteredSize +
          " node(s) found that could halt the network if they fail",
      };
    }

    if (
      this.network.networkStatistics.minBlockingSetOrgsFilteredSize &&
      this.network.networkStatistics.minBlockingSetOrgsFilteredSize <= 1
    ) {
      return {
        label: "Liveness risk",
        description:
          "Organization found that could halt the network if it fails",
      };
    }

    return {
      label: "Ok",
      description: "No warnings",
    };
  }

  networkHasWarnings() {
    return this.getNetworkWarnings().label !== "Ok";
  }

  getNetworkDangers(): { label: string; description: string } {
    if (!this.network.networkStatistics.hasQuorumIntersection) {
      return {
        label: "Safety risk",
        description:
          "Network does not have quorum intersection and could have safety issues",
      };
    }

    if (!this.network.networkStatistics.hasTransitiveQuorumSet) {
      return {
        label: "Safety risk",
        description:
          "Network does not have a transitive quorum set and could have safety issues",
      };
    }

    if (this.network.networkStatistics.minBlockingSetFilteredSize === 0) {
      return {
        label: "Liveness risk",
        description:
          "Network could have liveness issues because all nodes in a blocking set are failing or this service is malfunctioning. Check https://dashboard.stellar.org",
      };
    }

    return {
      label: "Ok",
      description: "No dangers",
    };
  }

  networkHasDangers() {
    return this.getNetworkDangers().label !== "Ok";
  }

  getDateFromParam(date: unknown) {
    if (!isString(date)) return undefined;

    const timestamp = Date.parse(date);

    if (!isNaN(timestamp)) return new Date(timestamp);
    else return undefined;
  }

  copyAndModifyObject(
    myObject: Record<string, unknown>,
    propsToModifyOrAdd: { key: string; value: unknown }[] = [],
    propsToDelete: string[] = [],
  ) {
    const copy: Record<string, unknown> = Object.assign({}, myObject);
    propsToModifyOrAdd.forEach((prop) => {
      copy[prop.key] = prop.value;
    });
    propsToDelete.forEach((prop) => {
      delete copy[prop];
    });

    return copy;
  }
}

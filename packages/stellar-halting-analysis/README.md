# stellar-halting-analysis

Analyze a transitive quorum to find halting weaknesses.  Runs through all the nodes and checks for any combination of N failures which can cause your node to halt.  This is a more thorough version of the stellar-core /info endpoint's `fail-at` property, since the built-in version doesn't handle propagation of failures.

The algorithm will return an array of HaltingFailures, which have arrays of `vulnerableNodes` (the nodes which can go down and take our network with it) and `affectedNodes` (the nodes which get taken down along the way.

### usage
```ts
import { haltingAnalysis, NetworkGraphNode } from "@stellar/halting-analysis"

const nodes : NetworkGraphNode[] = await getJSON("http://stellar-core-host:11626/quorum?transitive=true&fullnodes=true"

// Search for any single node which could cause our network to halt if it goes down
const failures : HaltingFailure[] = haltingAnalysis(nodes, 1)

// Search for any combination of up to 3 nodes which could cause our node to halt if they all failed
const failures = haltingAnalysis(nodes, 3)

```

### type definitions

```ts
// Represents a failure case where a set of N nodes can take down your network
type HaltingFailure = {
  // The nodes which can go down and cause havoc
  vulnerableNodes: NetworkGraphNode[];
  // The nodes which will go down in response to the vulnerable nodes
  affectedNodes: NetworkGraphNode[];
};

// A QuorumSetGroup can be either a grouping of validators as a single
// quorum set, or a group of inner quorum sets
export type QuorumSet = {
  // Threshold, the number of validators that need to agree
  readonly t: number;
  // List of validators or subquorum sets
  readonly v: (string | QuorumSet)[];
};

export type NetworkGraphNode = {
  // How far that node is from the root node (ie. how many quorum set hops)
  // 0 means this is the node being administrated
  readonly distance: number;
  // The latest ledger sequence number that this node voted at
  readonly heard?: number;
  // The identity of the validator
  readonly node: string;
  // Quorum set.  Missing or unknown nodes will be undefined.
  readonly qset?: QuorumSet;
  // one of behind|tracking|ahead (compared to the root node) or missing|unknown (when there are no recent SCP messages for that node)
  readonly status: "behind" | "tracking" | "ahead" | "missing" | "unknown";
  // what the node is voting for
  readonly value?: string;
  // a unique ID for what the node is voting for (allows to quickly tell if nodes are voting for the same thing)
  readonly value_id?: number;
};

```
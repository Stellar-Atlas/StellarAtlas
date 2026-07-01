import { Node, TrustGraph } from 'shared';
import { NodeTrustGraphBuilder } from './NodeTrustGraphBuilder';
import useStore from '@/store/useStore';

export class NodeTrustIndexService {
  private static trustGraphCache: TrustGraph | null = null;
  private static lastCacheTime: number = 0;
  private static readonly CACHE_DURATION_MS = 30000; // 30 seconds

  /**
   * Calculate trust index for a node based on current network state
   * @param node - The node to calculate trust index for
   * @returns Trust index score (0 to 1) or null if cannot be calculated
   */
  static getTrustIndex(node: Node): number | null {
    try {
      const trustGraph = this.getTrustGraph();
      if (!trustGraph) {
        return null;
      }

      return this.calculateTrustIndex(node.publicKey, trustGraph);
    } catch (error) {
      console.error('Error calculating trust index for node:', node.publicKey, error);
      return null;
    }
  }

  /**
   * Get trust indices for multiple nodes efficiently
   * @param nodes - Array of nodes to calculate trust indices for
   * @returns Map of publicKey to trust index
   */
  static getTrustIndices(nodes: Node[]): Map<string, number | null> {
    const result = new Map<string, number | null>();
    
    try {
      const trustGraph = this.getTrustGraph();
      if (!trustGraph) {
        // Return null for all nodes if trust graph unavailable
        nodes.forEach(node => result.set(node.publicKey, null));
        return result;
      }

      nodes.forEach(node => {
        const trustIndex = this.calculateTrustIndex(node.publicKey, trustGraph);
        result.set(node.publicKey, trustIndex);
      });
    } catch (error) {
      console.error('Error calculating trust indices:', error);
      nodes.forEach(node => result.set(node.publicKey, null));
    }

    return result;
  }

  /**
   * Get cached trust graph or build a new one if cache is stale
   */
  private static getTrustGraph(): TrustGraph | null {
    const now = Date.now();
    
    if (
      this.trustGraphCache && 
      (now - this.lastCacheTime) < this.CACHE_DURATION_MS
    ) {
      return this.trustGraphCache;
    }

    try {
      const store = useStore();
      const network = store.network;
      
      if (!network || !network.nodes || network.nodes.length === 0) {
        return null;
      }

      // Build trust graph from current network state
      this.trustGraphCache = NodeTrustGraphBuilder.build(network.nodes);
      this.lastCacheTime = now;
      
      return this.trustGraphCache;
    } catch (error) {
      console.error('Error building trust graph:', error);
      return null;
    }
  }

  /**
   * Calculate trust index using the same logic as backend TrustIndex.get()
   * @param publicKey - Public key of the node
   * @param trustGraph - Trust graph to analyze
   * @returns Trust index (0 to 1) or null if cannot be calculated
   */
  private static calculateTrustIndex(
    publicKey: string, 
    trustGraph: TrustGraph
  ): number | null {
    const vertex = trustGraph.getVertex(publicKey);
    
    if (!vertex) {
      return null;
    }

    // Count total number of nodes with outgoing trust relationships (excluding self)
    const totalValidatingNodes = Array.from(trustGraph.vertices.values())
      .filter(v => trustGraph.getOutDegree(v) > 0).length - 1;
    
    if (totalValidatingNodes <= 0) {
      return 0;
    }

    // Count how many nodes trust this vertex (excluding self-trust)
    const trustingNodes = Array.from(trustGraph.getParents(vertex))
      .filter(parent => parent.key !== vertex.key).length;
    
    return trustingNodes / totalValidatingNodes;
  }

  /**
   * Clear the trust graph cache (useful for testing or forced refresh)
   */
  static clearCache(): void {
    this.trustGraphCache = null;
    this.lastCacheTime = 0;
  }
}
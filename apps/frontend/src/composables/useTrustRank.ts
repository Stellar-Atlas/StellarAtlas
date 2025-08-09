import { computed, ref, ComputedRef } from 'vue';
import { Node } from 'shared';
import { TrustRankColorService, TrustLevel } from '@/services/TrustRankColorService';
import { NodeTrustIndexService } from '@/services/NodeTrustIndexService';

export interface UseTrustRankOptions {
  enableCaching?: boolean;
  autoRefresh?: boolean;
}

export function useTrustRank(node: ComputedRef<Node> | Node, options: UseTrustRankOptions = {}) {
  const { enableCaching = true, autoRefresh = false } = options;
  
  // Internal cache for trust index
  const trustIndexCache = ref<Map<string, number | null>>(new Map());
  
  // Computed trust index for the node
  const trustIndex = computed<number | null>(() => {
    const currentNode = typeof node === 'function' ? node.value : node;
    
    if (!currentNode) {
      return null;
    }

    // Check cache first if caching is enabled
    if (enableCaching && trustIndexCache.value.has(currentNode.publicKey)) {
      return trustIndexCache.value.get(currentNode.publicKey) ?? null;
    }

    const calculatedTrustIndex = NodeTrustIndexService.getTrustIndex(currentNode);
    
    // Update cache if caching is enabled
    if (enableCaching) {
      trustIndexCache.value.set(currentNode.publicKey, calculatedTrustIndex);
    }
    
    return calculatedTrustIndex;
  });

  // Trust level information
  const trustLevel = computed<TrustLevel>(() => {
    return TrustRankColorService.getTrustLevel(trustIndex.value);
  });

  // Individual trust properties for easy access
  const trustColor = computed(() => trustLevel.value.color);
  const trustBackgroundColor = computed(() => trustLevel.value.backgroundColor);
  const trustBorderColor = computed(() => trustLevel.value.borderColor);
  const trustLabel = computed(() => trustLevel.value.label);
  const trustBadgeVariant = computed(() => 
    TrustRankColorService.getTrustBadgeVariant(trustIndex.value)
  );
  const trustPercentage = computed(() => 
    TrustRankColorService.formatTrustPercentage(trustIndex.value)
  );

  // Helper methods
  const refreshTrustIndex = () => {
    const currentNode = typeof node === 'function' ? node.value : node;
    if (currentNode) {
      trustIndexCache.value.delete(currentNode.publicKey);
      // Force recomputation by accessing the computed property
      void trustIndex.value;
    }
  };

  const clearCache = () => {
    trustIndexCache.value.clear();
    NodeTrustIndexService.clearCache();
  };

  // Auto-refresh setup (optional)
  if (autoRefresh) {
    const interval = setInterval(() => {
      refreshTrustIndex();
    }, 60000); // Refresh every minute

    // Note: In a real Vue component, you'd want to clear this interval onUnmounted
    // This composable assumes the consuming component will handle cleanup
  }

  return {
    // Computed values
    trustIndex,
    trustLevel,
    trustColor,
    trustBackgroundColor, 
    trustBorderColor,
    trustLabel,
    trustBadgeVariant,
    trustPercentage,
    
    // Methods
    refreshTrustIndex,
    clearCache
  };
}

// Utility function for batch trust index calculation
export function useTrustRankBatch(nodes: ComputedRef<Node[]> | Node[]) {
  const trustIndices = ref<Map<string, number | null>>(new Map());

  const updateTrustIndices = () => {
    const currentNodes = typeof nodes === 'function' ? nodes.value : nodes;
    trustIndices.value = NodeTrustIndexService.getTrustIndices(currentNodes);
  };

  const getTrustLevel = (publicKey: string): TrustLevel => {
    const trustIndex = trustIndices.value.get(publicKey);
    return TrustRankColorService.getTrustLevel(trustIndex);
  };

  const getTrustColor = (publicKey: string): string => {
    return getTrustLevel(publicKey).color;
  };

  const getTrustBadgeVariant = (publicKey: string): string => {
    const trustIndex = trustIndices.value.get(publicKey);
    return TrustRankColorService.getTrustBadgeVariant(trustIndex);
  };

  const getTrustPercentage = (publicKey: string): string => {
    const trustIndex = trustIndices.value.get(publicKey);
    return TrustRankColorService.formatTrustPercentage(trustIndex);
  };

  // Initialize
  updateTrustIndices();

  return {
    trustIndices,
    updateTrustIndices,
    getTrustLevel,
    getTrustColor,
    getTrustBadgeVariant,
    getTrustPercentage
  };
}
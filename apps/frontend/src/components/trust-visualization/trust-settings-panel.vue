<template>
  <div class="trust-settings-panel card">
    <div class="card-header">
      <h5 class="mb-0">
        <i class="fas fa-shield-alt mr-2"></i>
        Trust Visualization Settings
      </h5>
    </div>
    
    <div class="card-body">
      <div class="form-group">
        <div class="custom-control custom-switch">
          <input
            id="trust-enabled"
            v-model="enabled"
            type="checkbox"
            class="custom-control-input"
          />
          <label class="custom-control-label" for="trust-enabled">
            Enable Trust Visualization
          </label>
        </div>
        <small class="form-text text-muted">
          Show trust indicators throughout the interface
        </small>
      </div>

      <div v-if="enabled" class="trust-options">
        <h6 class="mt-4 mb-3">Display Options</h6>
        
        <div class="form-group">
          <div class="custom-control custom-switch">
            <input
              id="show-network-map"
              v-model="showInNetworkMap"
              type="checkbox"
              class="custom-control-input"
            />
            <label class="custom-control-label" for="show-network-map">
              Show in Network Map
            </label>
          </div>
          <small class="form-text text-muted">
            Color nodes on the world map based on trust levels
          </small>
        </div>

        <div class="form-group">
          <div class="custom-control custom-switch">
            <input
              id="show-validator-lists"
              v-model="showInValidatorLists"
              type="checkbox"
              class="custom-control-input"
            />
            <label class="custom-control-label" for="show-validator-lists">
              Show in Validator Lists
            </label>
          </div>
          <small class="form-text text-muted">
            Display trust badges in validator dropdowns and lists
          </small>
        </div>

        <div class="form-group">
          <div class="custom-control custom-switch">
            <input
              id="show-trust-graph"
              v-model="showInTrustGraph"
              type="checkbox"
              class="custom-control-input"
            />
            <label class="custom-control-label" for="show-trust-graph">
              Show in Trust Graph
            </label>
          </div>
          <small class="form-text text-muted">
            Display trust percentages on trust graph nodes
          </small>
        </div>

        <div class="form-group">
          <div class="custom-control custom-switch">
            <input
              id="show-percentages"
              v-model="showPercentages"
              type="checkbox"
              class="custom-control-input"
            />
            <label class="custom-control-label" for="show-percentages">
              Show Trust Percentages
            </label>
          </div>
          <small class="form-text text-muted">
            Display exact trust percentages alongside color indicators
          </small>
        </div>

        <h6 class="mt-4 mb-3">Color Scheme</h6>
        
        <div class="form-group">
          <div class="form-check">
            <input
              id="color-default"
              v-model="colorScheme"
              value="default"
              type="radio"
              class="form-check-input"
            />
            <label class="form-check-label" for="color-default">
              Default Colors
            </label>
          </div>
          
          <div class="form-check">
            <input
              id="color-colorblind"
              v-model="colorScheme"
              value="colorblind"
              type="radio"
              class="form-check-input"
            />
            <label class="form-check-label" for="color-colorblind">
              Colorblind Friendly
            </label>
          </div>
          
          <div class="form-check">
            <input
              id="color-monochrome"
              v-model="colorScheme"
              value="monochrome"
              type="radio"
              class="form-check-input"
            />
            <label class="form-check-label" for="color-monochrome">
              Monochrome
            </label>
          </div>
        </div>

        <div class="trust-legend mt-4">
          <h6>Trust Level Legend</h6>
          <div class="legend-items">
            <div class="legend-item">
              <div class="trust-color high-trust"></div>
              <span>High Trust (70%+)</span>
            </div>
            <div class="legend-item">
              <div class="trust-color medium-trust"></div>
              <span>Medium Trust (30-70%)</span>
            </div>
            <div class="legend-item">
              <div class="trust-color low-trust"></div>
              <span>Low Trust (10-30%)</span>
            </div>
            <div class="legend-item">
              <div class="trust-color unknown-trust"></div>
              <span>Unknown/New (&lt;10%)</span>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-4">
        <button 
          type="button" 
          class="btn btn-secondary mr-2" 
          @click="resetToDefaults"
        >
          Reset to Defaults
        </button>
        <button 
          type="button" 
          class="btn btn-primary" 
          @click="$emit('close')"
        >
          Done
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTrustVisualizationSettings } from '@/composables/useTrustVisualizationSettings';

defineEmits(['close']);

const {
  enabled,
  showInNetworkMap,
  showInValidatorLists,
  showInTrustGraph,
  showPercentages,
  colorScheme,
  resetToDefaults
} = useTrustVisualizationSettings();
</script>

<style scoped>
.trust-settings-panel {
  max-width: 500px;
}

.trust-options {
  border-left: 3px solid #007bff;
  padding-left: 1rem;
  margin-left: 0.5rem;
}

.trust-legend {
  background: #f8f9fa;
  padding: 1rem;
  border-radius: 0.375rem;
}

.legend-items {
  display: grid;
  gap: 0.5rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.trust-color {
  width: 20px;
  height: 12px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.trust-color.high-trust {
  background-color: #28a745;
}

.trust-color.medium-trust {
  background-color: #ffc107;
}

.trust-color.low-trust {
  background-color: #fd7e14;
}

.trust-color.unknown-trust {
  background-color: #6c757d;
}
</style>
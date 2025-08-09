import { ref, computed, watchEffect } from 'vue';
import { 
  TrustVisualizationSettings,
  TrustVisualizationSettingsService
} from '@/services/TrustVisualizationSettings';

// Global reactive settings state
const settings = ref<TrustVisualizationSettings>(
  TrustVisualizationSettingsService.loadSettings()
);

export function useTrustVisualizationSettings() {
  // Individual computed properties for easy access
  const enabled = computed({
    get: () => settings.value.enabled,
    set: (value: boolean) => {
      settings.value = TrustVisualizationSettingsService.updateSetting('enabled', value);
    }
  });

  const showInNetworkMap = computed({
    get: () => settings.value.showInNetworkMap,
    set: (value: boolean) => {
      settings.value = TrustVisualizationSettingsService.updateSetting('showInNetworkMap', value);
    }
  });

  const showInValidatorLists = computed({
    get: () => settings.value.showInValidatorLists,
    set: (value: boolean) => {
      settings.value = TrustVisualizationSettingsService.updateSetting('showInValidatorLists', value);
    }
  });

  const showInTrustGraph = computed({
    get: () => settings.value.showInTrustGraph,
    set: (value: boolean) => {
      settings.value = TrustVisualizationSettingsService.updateSetting('showInTrustGraph', value);
    }
  });

  const showPercentages = computed({
    get: () => settings.value.showPercentages,
    set: (value: boolean) => {
      settings.value = TrustVisualizationSettingsService.updateSetting('showPercentages', value);
    }
  });

  const colorScheme = computed({
    get: () => settings.value.colorScheme,
    set: (value: 'default' | 'colorblind' | 'monochrome') => {
      settings.value = TrustVisualizationSettingsService.updateSetting('colorScheme', value);
    }
  });

  // Combined computed properties for common use cases
  const shouldShowInComponent = computed(() => {
    return (component: 'networkMap' | 'validatorLists' | 'trustGraph') => {
      if (!settings.value.enabled) return false;
      
      switch (component) {
        case 'networkMap':
          return settings.value.showInNetworkMap;
        case 'validatorLists':
          return settings.value.showInValidatorLists;
        case 'trustGraph':
          return settings.value.showInTrustGraph;
        default:
          return false;
      }
    };
  });

  // Methods
  const resetToDefaults = () => {
    settings.value = TrustVisualizationSettingsService.resetSettings();
  };

  const updateSettings = (newSettings: Partial<TrustVisualizationSettings>) => {
    const updatedSettings = {
      ...settings.value,
      ...newSettings
    };
    TrustVisualizationSettingsService.saveSettings(updatedSettings);
    settings.value = updatedSettings;
  };

  const toggleEnabled = () => {
    enabled.value = !enabled.value;
  };

  return {
    // Reactive settings
    settings: computed(() => settings.value),
    
    // Individual settings
    enabled,
    showInNetworkMap,
    showInValidatorLists,
    showInTrustGraph,
    showPercentages,
    colorScheme,
    
    // Computed helpers
    shouldShowInComponent,
    
    // Methods
    resetToDefaults,
    updateSettings,
    toggleEnabled
  };
}

// Export singleton instance for app-wide settings consistency
export const globalTrustVisualizationSettings = useTrustVisualizationSettings();
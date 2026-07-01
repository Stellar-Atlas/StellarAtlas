export interface TrustVisualizationSettings {
  enabled: boolean;
  showInNetworkMap: boolean;
  showInValidatorLists: boolean;
  showInTrustGraph: boolean;
  showPercentages: boolean;
  colorScheme: 'default' | 'colorblind' | 'monochrome';
}

export class TrustVisualizationSettingsService {
  private static readonly STORAGE_KEY = 'stellarbeat-trust-visualization-settings';
  
  private static readonly DEFAULT_SETTINGS: TrustVisualizationSettings = {
    enabled: true,
    showInNetworkMap: true,
    showInValidatorLists: true,
    showInTrustGraph: true,
    showPercentages: true,
    colorScheme: 'default'
  };

  /**
   * Load trust visualization settings from localStorage
   */
  static loadSettings(): TrustVisualizationSettings {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) {
        return { ...this.DEFAULT_SETTINGS };
      }
      
      const parsed = JSON.parse(stored);
      
      // Merge with defaults to handle new settings that might not exist
      return {
        ...this.DEFAULT_SETTINGS,
        ...parsed
      };
    } catch (error) {
      console.warn('Error loading trust visualization settings:', error);
      return { ...this.DEFAULT_SETTINGS };
    }
  }

  /**
   * Save trust visualization settings to localStorage
   */
  static saveSettings(settings: TrustVisualizationSettings): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving trust visualization settings:', error);
    }
  }

  /**
   * Reset settings to defaults
   */
  static resetSettings(): TrustVisualizationSettings {
    const defaults = { ...this.DEFAULT_SETTINGS };
    this.saveSettings(defaults);
    return defaults;
  }

  /**
   * Update a specific setting
   */
  static updateSetting<K extends keyof TrustVisualizationSettings>(
    key: K,
    value: TrustVisualizationSettings[K]
  ): TrustVisualizationSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings = {
      ...currentSettings,
      [key]: value
    };
    
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }
}
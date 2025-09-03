export interface TrustRankColors {
  high: string;
  medium: string;
  low: string;
  unknown: string;
}

export interface TrustLevel {
  level: 'high' | 'medium' | 'low' | 'unknown';
  color: string;
  backgroundColor: string;
  borderColor: string;
  label: string;
}

export class TrustRankColorService {
  private static readonly TRUST_THRESHOLDS = {
    HIGH: 0.7,  // 70% trust or higher
    MEDIUM: 0.3, // 30% - 70% trust
    LOW: 0.1     // 10% - 30% trust, below 10% is unknown/new
  };

  private static readonly COLORS: TrustRankColors = {
    high: '#28a745',    // Green - high trust
    medium: '#ffc107',  // Yellow - medium trust  
    low: '#fd7e14',     // Orange - low trust
    unknown: '#6c757d'  // Gray - unknown/no data
  };

  /**
   * Calculate trust level based on trust index score
   * @param trustIndex - Trust index score from TrustIndex.get() (0 to 1)
   * @returns Trust level information including color and label
   */
  static getTrustLevel(trustIndex: number | null | undefined): TrustLevel {
    if (trustIndex === null || trustIndex === undefined || trustIndex <= 0) {
      return {
        level: 'unknown',
        color: this.COLORS.unknown,
        backgroundColor: this.COLORS.unknown + '20', // 20% opacity
        borderColor: this.COLORS.unknown,
        label: 'Unknown'
      };
    }

    if (trustIndex >= this.TRUST_THRESHOLDS.HIGH) {
      return {
        level: 'high',
        color: this.COLORS.high,
        backgroundColor: this.COLORS.high + '20',
        borderColor: this.COLORS.high,
        label: 'High Trust'
      };
    }

    if (trustIndex >= this.TRUST_THRESHOLDS.MEDIUM) {
      return {
        level: 'medium', 
        color: this.COLORS.medium,
        backgroundColor: this.COLORS.medium + '20',
        borderColor: this.COLORS.medium,
        label: 'Medium Trust'
      };
    }

    if (trustIndex >= this.TRUST_THRESHOLDS.LOW) {
      return {
        level: 'low',
        color: this.COLORS.low,
        backgroundColor: this.COLORS.low + '20', 
        borderColor: this.COLORS.low,
        label: 'Low Trust'
      };
    }

    return {
      level: 'unknown',
      color: this.COLORS.unknown,
      backgroundColor: this.COLORS.unknown + '20',
      borderColor: this.COLORS.unknown,
      label: 'New Node'
    };
  }

  /**
   * Get trust color based on trust index
   * @param trustIndex - Trust index score (0 to 1)
   * @returns Hex color code
   */
  static getTrustColor(trustIndex: number | null | undefined): string {
    return this.getTrustLevel(trustIndex).color;
  }

  /**
   * Get trust badge variant for Bootstrap components
   * @param trustIndex - Trust index score (0 to 1)
   * @returns Bootstrap variant string
   */
  static getTrustBadgeVariant(trustIndex: number | null | undefined): string {
    const level = this.getTrustLevel(trustIndex);
    switch (level.level) {
      case 'high':
        return 'success';
      case 'medium':
        return 'warning';
      case 'low':
        return 'secondary';
      case 'unknown':
      default:
        return 'light';
    }
  }

  /**
   * Format trust index as percentage string
   * @param trustIndex - Trust index score (0 to 1)
   * @returns Formatted percentage string
   */
  static formatTrustPercentage(trustIndex: number | null | undefined): string {
    if (trustIndex === null || trustIndex === undefined) {
      return 'N/A';
    }
    return `${Math.round(trustIndex * 100)}%`;
  }
}
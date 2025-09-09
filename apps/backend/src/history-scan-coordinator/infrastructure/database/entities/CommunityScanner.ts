import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
  BeforeUpdate
} from 'typeorm';
import { IsEmail, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export enum ScannerStatus {
  PENDING = 'pending',
  ONLINE = 'online',
  OFFLINE = 'offline',
  DEGRADED = 'degraded'
}

@Entity('community_scanners')
export class CommunityScanner {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @Column({ name: 'contact_email', type: 'varchar', length: 255 })
  @IsEmail()
  @IsNotEmpty()
  contactEmail!: string;

  @Column({ name: 'api_key', type: 'varchar', length: 255, unique: true })
  @IsNotEmpty()
  apiKey!: string;

  @Column({
    type: 'enum',
    enum: ScannerStatus,
    default: ScannerStatus.PENDING
  })
  status: ScannerStatus = ScannerStatus.PENDING;

  @Column({ name: 'success_rate', type: 'decimal', precision: 5, scale: 2, default: 0 })
  successRate: number = 0;

  @Column({ name: 'average_completion_time_ms', type: 'bigint', default: 0 })
  averageCompletionTimeMs: number = 0;

  @Column({ name: 'total_jobs_completed', type: 'bigint', default: 0 })
  totalJobsCompleted: number = 0;

  @Column({ name: 'total_jobs_failed', type: 'bigint', default: 0 })
  totalJobsFailed: number = 0;

  @Column({ name: 'current_active_jobs', type: 'integer', default: 0 })
  currentActiveJobs: number = 0;

  @Column({ name: 'is_blacklisted', type: 'boolean', default: false })
  isBlacklisted: boolean = false;

  @Column({ name: 'blacklisted_until', type: 'timestamp', nullable: true })
  blacklistedUntil?: Date;

  @Column({ name: 'last_heartbeat_at', type: 'timestamp', nullable: true })
  lastHeartbeatAt?: Date | null = null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeEmail(): void {
    if (this.contactEmail) {
      this.contactEmail = this.contactEmail.toLowerCase().trim();
    }
  }

  updateSuccessRate(): void {
    const totalJobs = this.totalJobsCompleted + this.totalJobsFailed;
    if (totalJobs === 0) {
      this.successRate = 0;
    } else {
      this.successRate = Math.round((this.totalJobsCompleted / totalJobs) * 100);
    }
  }

  updatePerformanceMetrics(completionTimeMs: number, success: boolean): void {
    if (success) {
      const totalCompletedJobs = this.totalJobsCompleted + 1;
      const totalCompletionTime = (this.averageCompletionTimeMs * this.totalJobsCompleted) + completionTimeMs;
      this.averageCompletionTimeMs = Math.round(totalCompletionTime / totalCompletedJobs);
      this.totalJobsCompleted += 1;
    } else {
      this.totalJobsFailed += 1;
    }
    
    this.updateSuccessRate();
  }

  updateHeartbeat(): void {
    this.lastHeartbeatAt = new Date();
  }

  isAlive(): boolean {
    if (!this.lastHeartbeatAt) {
      return false;
    }
    
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return this.lastHeartbeatAt > fiveMinutesAgo;
  }

  calculateWeight(): number {
    // Return 0 for blacklisted or dead scanners
    if (this.isBlacklisted || !this.isAlive()) {
      return 0;
    }

    const baseWeight = 100;

    // Performance multiplier (0.5 - 2.0) based on success rate and completion time
    const successMultiplier = Math.max(0.5, Math.min(2.0, this.successRate / 50)); // 100% = 2.0, 50% = 1.0, 25% = 0.5
    
    // Faster completion gets higher weight (baseline: 30 seconds)
    const baselineCompletionTime = 30000;
    const timeMultiplier = this.averageCompletionTimeMs > 0 
      ? Math.max(0.5, Math.min(2.0, baselineCompletionTime / this.averageCompletionTimeMs))
      : 1.0;

    // Load multiplier (0.5 - 1.5) based on current active jobs
    const loadMultiplier = Math.max(0.5, Math.min(1.5, 1.0 - (this.currentActiveJobs * 0.1)));

    // Availability multiplier based on recent heartbeat activity
    const heartbeatAge = this.lastHeartbeatAt 
      ? (Date.now() - this.lastHeartbeatAt.getTime()) / (60 * 1000) // minutes
      : 10;
    const availabilityMultiplier = Math.max(0.8, Math.min(1.2, 1.2 - (heartbeatAge / 10)));

    const finalWeight = baseWeight * successMultiplier * timeMultiplier * loadMultiplier * availabilityMultiplier;
    return Math.round(Math.max(0, finalWeight));
  }
}
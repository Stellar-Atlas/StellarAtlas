import { Repository } from 'typeorm';
import { CommunityScanner, ScannerStatus } from '../infrastructure/database/entities/CommunityScanner';

export interface ScannerMetrics {
  totalScanners: number;
  activeScanners: number;
  offlineScanners: number;
  degradedScanners: number;
  pendingScanners: number;
  averageSuccessRate: number;
  totalJobsCompleted: number;
  totalJobsFailed: number;
  averageCompletionTimeMs: number;
}

export class GetScannerMetrics {
  constructor(private readonly scannerRepository: Repository<CommunityScanner>) {}

  async execute(): Promise<ScannerMetrics> {
    // Get status counts
    const [
      totalScanners,
      activeScanners,
      offlineScanners,
      degradedScanners,
      pendingScanners
    ] = await Promise.all([
      this.scannerRepository.count({}),
      this.scannerRepository.count({ where: { status: ScannerStatus.ONLINE } }),
      this.scannerRepository.count({ where: { status: ScannerStatus.OFFLINE } }),
      this.scannerRepository.count({ where: { status: ScannerStatus.DEGRADED } }),
      this.scannerRepository.count({ where: { status: ScannerStatus.PENDING } })
    ]);

    // Get aggregate metrics
    const aggregateResult = await this.scannerRepository
      .createQueryBuilder('scanner')
      .select([
        'AVG(scanner.successRate) as avgSuccessRate',
        'SUM(scanner.totalJobsCompleted) as totalCompleted',
        'SUM(scanner.totalJobsFailed) as totalFailed',
        'AVG(scanner.averageCompletionTimeMs) as avgCompletionTime'
      ])
      .getRawOne();

    return {
      totalScanners,
      activeScanners,
      offlineScanners,
      degradedScanners,
      pendingScanners,
      averageSuccessRate: aggregateResult?.avgSuccessRate ? parseFloat(aggregateResult.avgSuccessRate) : 0,
      totalJobsCompleted: aggregateResult?.totalCompleted ? parseInt(aggregateResult.totalCompleted, 10) : 0,
      totalJobsFailed: aggregateResult?.totalFailed ? parseInt(aggregateResult.totalFailed, 10) : 0,
      averageCompletionTimeMs: aggregateResult?.avgCompletionTime ? parseFloat(aggregateResult.avgCompletionTime) : 0
    };
  }
}
import { GetScannerMetrics } from '../GetScannerMetrics';
import { CommunityScanner, ScannerStatus } from '../../infrastructure/database/entities/CommunityScanner';
import { Repository } from 'typeorm';

describe('GetScannerMetrics', () => {
  let useCase: GetScannerMetrics;
  let mockRepository: jest.Mocked<Repository<CommunityScanner>>;

  beforeEach(() => {
    mockRepository = {
      count: jest.fn(),
      createQueryBuilder: jest.fn()
    } as any;

    useCase = new GetScannerMetrics(mockRepository);
  });

  it('should return comprehensive scanner metrics', async () => {
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn()
    };

    // Mock total scanners count
    mockRepository.count.mockResolvedValue(10);

    // Mock status counts
    mockRepository.count
      .mockResolvedValueOnce(10) // total scanners
      .mockResolvedValueOnce(6)  // online scanners
      .mockResolvedValueOnce(2)  // offline scanners
      .mockResolvedValueOnce(1)  // degraded scanners
      .mockResolvedValueOnce(1); // pending scanners

    // Mock aggregate metrics query
    mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
    mockQueryBuilder.getRawOne.mockResolvedValue({
      avgSuccessRate: '85.50',
      totalCompleted: '1250',
      totalFailed: '150',
      avgCompletionTime: '15000'
    });

    const result = await useCase.execute();

    expect(result).toEqual({
      totalScanners: 10,
      activeScanners: 6,
      offlineScanners: 2,
      degradedScanners: 1,
      pendingScanners: 1,
      averageSuccessRate: 85.5,
      totalJobsCompleted: 1250,
      totalJobsFailed: 150,
      averageCompletionTimeMs: 15000
    });

    // Verify repository calls
    expect(mockRepository.count).toHaveBeenCalledTimes(5);
    expect(mockRepository.count).toHaveBeenNthCalledWith(1, {});
    expect(mockRepository.count).toHaveBeenNthCalledWith(2, { where: { status: ScannerStatus.ONLINE } });
    expect(mockRepository.count).toHaveBeenNthCalledWith(3, { where: { status: ScannerStatus.OFFLINE } });
    expect(mockRepository.count).toHaveBeenNthCalledWith(4, { where: { status: ScannerStatus.DEGRADED } });
    expect(mockRepository.count).toHaveBeenNthCalledWith(5, { where: { status: ScannerStatus.PENDING } });

    expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('scanner');
    expect(mockQueryBuilder.select).toHaveBeenCalledWith([
      'AVG(scanner.successRate) as avgSuccessRate',
      'SUM(scanner.totalJobsCompleted) as totalCompleted',
      'SUM(scanner.totalJobsFailed) as totalFailed',
      'AVG(scanner.averageCompletionTimeMs) as avgCompletionTime'
    ]);
    expect(mockQueryBuilder.getRawOne).toHaveBeenCalled();
  });

  it('should handle empty database gracefully', async () => {
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn()
    };

    // Mock no scanners
    mockRepository.count.mockResolvedValue(0);

    mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
    mockQueryBuilder.getRawOne.mockResolvedValue({
      avgSuccessRate: null,
      totalCompleted: null,
      totalFailed: null,
      avgCompletionTime: null
    });

    const result = await useCase.execute();

    expect(result).toEqual({
      totalScanners: 0,
      activeScanners: 0,
      offlineScanners: 0,
      degradedScanners: 0,
      pendingScanners: 0,
      averageSuccessRate: 0,
      totalJobsCompleted: 0,
      totalJobsFailed: 0,
      averageCompletionTimeMs: 0
    });
  });

  it('should handle null aggregate values', async () => {
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn()
    };

    mockRepository.count
      .mockResolvedValueOnce(5)  // total scanners
      .mockResolvedValueOnce(3)  // online scanners
      .mockResolvedValueOnce(1)  // offline scanners
      .mockResolvedValueOnce(0)  // degraded scanners
      .mockResolvedValueOnce(1); // pending scanners

    mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
    mockQueryBuilder.getRawOne.mockResolvedValue({
      avgSuccessRate: null,
      totalCompleted: '0',
      totalFailed: '0',
      avgCompletionTime: null
    });

    const result = await useCase.execute();

    expect(result.averageSuccessRate).toBe(0);
    expect(result.averageCompletionTimeMs).toBe(0);
    expect(result.totalJobsCompleted).toBe(0);
    expect(result.totalJobsFailed).toBe(0);
  });

  it('should handle database errors', async () => {
    mockRepository.count.mockRejectedValue(new Error('Database connection failed'));

    await expect(useCase.execute()).rejects.toThrow('Database connection failed');
  });

  it('should handle aggregate query errors', async () => {
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn()
    };

    mockRepository.count.mockResolvedValue(5);
    mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
    mockQueryBuilder.getRawOne.mockRejectedValue(new Error('Aggregate query failed'));

    await expect(useCase.execute()).rejects.toThrow('Aggregate query failed');
  });

  it('should correctly parse string numbers from database', async () => {
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn()
    };

    mockRepository.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
    mockQueryBuilder.getRawOne.mockResolvedValue({
      avgSuccessRate: '95.75',
      totalCompleted: '500',
      totalFailed: '25',
      avgCompletionTime: '12500.50'
    });

    const result = await useCase.execute();

    expect(result.averageSuccessRate).toBe(95.75);
    expect(result.totalJobsCompleted).toBe(500);
    expect(result.totalJobsFailed).toBe(25);
    expect(result.averageCompletionTimeMs).toBe(12500.5);
  });
});
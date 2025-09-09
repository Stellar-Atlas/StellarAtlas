import { SendScannerHeartbeat } from '../SendScannerHeartbeat';
import { CommunityScanner, ScannerStatus } from '../../infrastructure/database/entities/CommunityScanner';
import { Repository } from 'typeorm';

describe('SendScannerHeartbeat', () => {
  let useCase: SendScannerHeartbeat;
  let mockRepository: jest.Mocked<Repository<CommunityScanner>>;

  beforeEach(() => {
    mockRepository = {
      findOne: jest.fn(),
      save: jest.fn()
    } as any;

    useCase = new SendScannerHeartbeat(mockRepository);
  });

  const validRequest = {
    scannerId: 'scanner-uuid',
    apiKey: 'valid-api-key'
  };

  it('should update heartbeat for valid scanner', async () => {
    const pastTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    const existingScanner = new CommunityScanner();
    existingScanner.id = validRequest.scannerId;
    existingScanner.apiKey = validRequest.apiKey;
    existingScanner.status = ScannerStatus.ONLINE;
    existingScanner.isBlacklisted = false;
    existingScanner.lastHeartbeatAt = pastTime;

    mockRepository.findOne.mockResolvedValue(existingScanner);
    mockRepository.save.mockImplementation((scanner) => Promise.resolve(scanner as CommunityScanner));

    const beforeCall = Date.now();
    const result = await useCase.execute(validRequest);
    const afterCall = Date.now();

    expect(mockRepository.findOne).toHaveBeenCalledWith({
      where: { id: validRequest.scannerId }
    });

    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: validRequest.scannerId,
        lastHeartbeatAt: expect.any(Date)
      })
    );

    expect(result.lastHeartbeatAt).toBeInstanceOf(Date);
    expect(result.lastHeartbeatAt!.getTime()).toBeGreaterThanOrEqual(beforeCall);
    expect(result.lastHeartbeatAt!.getTime()).toBeLessThanOrEqual(afterCall);
    expect(result.lastHeartbeatAt!.getTime()).toBeGreaterThan(pastTime.getTime());
  });

  it('should throw error for non-existent scanner', async () => {
    mockRepository.findOne.mockResolvedValue(null);

    await expect(useCase.execute(validRequest)).rejects.toThrow(
      'Scanner not found'
    );

    expect(mockRepository.findOne).toHaveBeenCalledWith({
      where: { id: validRequest.scannerId }
    });
    expect(mockRepository.save).not.toHaveBeenCalled();
  });

  it('should throw error for invalid API key', async () => {
    const existingScanner = new CommunityScanner();
    existingScanner.id = validRequest.scannerId;
    existingScanner.apiKey = 'different-api-key';
    existingScanner.status = ScannerStatus.ONLINE;

    mockRepository.findOne.mockResolvedValue(existingScanner);

    await expect(useCase.execute(validRequest)).rejects.toThrow(
      'Invalid API key'
    );

    expect(mockRepository.findOne).toHaveBeenCalledWith({
      where: { id: validRequest.scannerId }
    });
    expect(mockRepository.save).not.toHaveBeenCalled();
  });

  it('should throw error for blacklisted scanner', async () => {
    const existingScanner = new CommunityScanner();
    existingScanner.id = validRequest.scannerId;
    existingScanner.apiKey = validRequest.apiKey;
    existingScanner.status = ScannerStatus.OFFLINE;
    existingScanner.isBlacklisted = true;

    mockRepository.findOne.mockResolvedValue(existingScanner);

    await expect(useCase.execute(validRequest)).rejects.toThrow(
      'Scanner is blacklisted'
    );

    expect(mockRepository.findOne).toHaveBeenCalledWith({
      where: { id: validRequest.scannerId }
    });
    expect(mockRepository.save).not.toHaveBeenCalled();
  });

  it('should update status from offline to online when sending heartbeat', async () => {
    const existingScanner = new CommunityScanner();
    existingScanner.id = validRequest.scannerId;
    existingScanner.apiKey = validRequest.apiKey;
    existingScanner.status = ScannerStatus.OFFLINE;
    existingScanner.isBlacklisted = false;

    mockRepository.findOne.mockResolvedValue(existingScanner);
    mockRepository.save.mockImplementation((scanner) => Promise.resolve(scanner as CommunityScanner));

    const result = await useCase.execute(validRequest);

    expect(result.status).toBe(ScannerStatus.ONLINE);
    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ScannerStatus.ONLINE
      })
    );
  });

  it('should update status from pending to online on first heartbeat', async () => {
    const existingScanner = new CommunityScanner();
    existingScanner.id = validRequest.scannerId;
    existingScanner.apiKey = validRequest.apiKey;
    existingScanner.status = ScannerStatus.PENDING;
    existingScanner.isBlacklisted = false;
    existingScanner.lastHeartbeatAt = null;

    mockRepository.findOne.mockResolvedValue(existingScanner);
    mockRepository.save.mockImplementation((scanner) => Promise.resolve(scanner as CommunityScanner));

    const result = await useCase.execute(validRequest);

    expect(result.status).toBe(ScannerStatus.ONLINE);
    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ScannerStatus.ONLINE,
        lastHeartbeatAt: expect.any(Date)
      })
    );
  });

  it('should handle database save errors', async () => {
    const existingScanner = new CommunityScanner();
    existingScanner.id = validRequest.scannerId;
    existingScanner.apiKey = validRequest.apiKey;
    existingScanner.status = ScannerStatus.ONLINE;
    existingScanner.isBlacklisted = false;

    mockRepository.findOne.mockResolvedValue(existingScanner);
    mockRepository.save.mockRejectedValue(new Error('Database connection failed'));

    await expect(useCase.execute(validRequest)).rejects.toThrow(
      'Database connection failed'
    );
  });

  it('should maintain degraded status if already degraded', async () => {
    const existingScanner = new CommunityScanner();
    existingScanner.id = validRequest.scannerId;
    existingScanner.apiKey = validRequest.apiKey;
    existingScanner.status = ScannerStatus.DEGRADED;
    existingScanner.isBlacklisted = false;

    mockRepository.findOne.mockResolvedValue(existingScanner);
    mockRepository.save.mockImplementation((scanner) => Promise.resolve(scanner as CommunityScanner));

    const result = await useCase.execute(validRequest);

    // Degraded status should be maintained until performance improves
    expect(result.status).toBe(ScannerStatus.DEGRADED);
  });
});
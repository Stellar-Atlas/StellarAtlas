import { validate } from 'class-validator';
import { CommunityScanner, ScannerStatus } from '../CommunityScanner';

describe('CommunityScanner Entity', () => {
  let scanner: CommunityScanner;

  beforeEach(() => {
    scanner = new CommunityScanner();
    scanner.name = 'Test Scanner';
    scanner.description = 'A test community scanner';
    scanner.contactEmail = 'test@example.com';
    scanner.apiKey = 'test-api-key-12345';
    scanner.status = ScannerStatus.ONLINE;
  });

  describe('validation', () => {
    it('should pass validation with valid data', async () => {
      const errors = await validate(scanner);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation with empty name', async () => {
      scanner.name = '';
      const errors = await validate(scanner);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('name');
    });

    it('should fail validation with name longer than 100 characters', async () => {
      scanner.name = 'a'.repeat(101);
      const errors = await validate(scanner);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('name');
    });

    it('should fail validation with invalid email format', async () => {
      scanner.contactEmail = 'invalid-email';
      const errors = await validate(scanner);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('contactEmail');
    });

    it('should fail validation with description longer than 500 characters', async () => {
      scanner.description = 'a'.repeat(501);
      const errors = await validate(scanner);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('description');
    });

    it('should pass validation with optional description empty', async () => {
      scanner.description = '';
      const errors = await validate(scanner);
      expect(errors).toHaveLength(0);
    });
  });

  describe('constructor', () => {
    it('should set default values correctly', () => {
      const newScanner = new CommunityScanner();
      expect(newScanner.status).toBe(ScannerStatus.PENDING);
      expect(newScanner.successRate).toBe(0);
      expect(newScanner.averageCompletionTimeMs).toBe(0);
      expect(newScanner.totalJobsCompleted).toBe(0);
      expect(newScanner.totalJobsFailed).toBe(0);
      expect(newScanner.isBlacklisted).toBe(false);
      expect(newScanner.currentActiveJobs).toBe(0);
    });

    it('should initialize with null timestamps before persistence', () => {
      const newScanner = new CommunityScanner();
      expect(newScanner.createdAt).toBeUndefined();
      expect(newScanner.updatedAt).toBeUndefined();
      expect(newScanner.lastHeartbeatAt).toBeNull();
    });
  });

  describe('status management', () => {
    it('should allow valid status transitions', () => {
      scanner.status = ScannerStatus.PENDING;
      expect(scanner.status).toBe(ScannerStatus.PENDING);

      scanner.status = ScannerStatus.ONLINE;
      expect(scanner.status).toBe(ScannerStatus.ONLINE);

      scanner.status = ScannerStatus.OFFLINE;
      expect(scanner.status).toBe(ScannerStatus.OFFLINE);

      scanner.status = ScannerStatus.DEGRADED;
      expect(scanner.status).toBe(ScannerStatus.DEGRADED);
    });
  });

  describe('performance metrics', () => {
    it('should calculate success rate correctly', () => {
      scanner.totalJobsCompleted = 80;
      scanner.totalJobsFailed = 20;
      scanner.updateSuccessRate();
      expect(scanner.successRate).toBe(80);
    });

    it('should handle zero total jobs for success rate', () => {
      scanner.totalJobsCompleted = 0;
      scanner.totalJobsFailed = 0;
      scanner.updateSuccessRate();
      expect(scanner.successRate).toBe(0);
    });

    it('should update performance metrics', () => {
      const completionTime = 5000;
      scanner.updatePerformanceMetrics(completionTime, true);
      
      expect(scanner.totalJobsCompleted).toBe(1);
      expect(scanner.totalJobsFailed).toBe(0);
      expect(scanner.averageCompletionTimeMs).toBe(completionTime);
      expect(scanner.successRate).toBe(100);
    });

    it('should track failed jobs correctly', () => {
      scanner.updatePerformanceMetrics(0, false);
      
      expect(scanner.totalJobsCompleted).toBe(0);
      expect(scanner.totalJobsFailed).toBe(1);
      expect(scanner.successRate).toBe(0);
    });
  });

  describe('heartbeat management', () => {
    it('should update heartbeat timestamp', () => {
      const beforeHeartbeat = new Date();
      scanner.updateHeartbeat();
      const afterHeartbeat = new Date();
      
      expect(scanner.lastHeartbeatAt).toBeInstanceOf(Date);
      expect(scanner.lastHeartbeatAt!.getTime()).toBeGreaterThanOrEqual(beforeHeartbeat.getTime());
      expect(scanner.lastHeartbeatAt!.getTime()).toBeLessThanOrEqual(afterHeartbeat.getTime());
    });

    it('should check if scanner is alive within 5 minutes', () => {
      scanner.lastHeartbeatAt = new Date(Date.now() - 4 * 60 * 1000); // 4 minutes ago
      expect(scanner.isAlive()).toBe(true);
    });

    it('should check if scanner is dead after 5 minutes', () => {
      scanner.lastHeartbeatAt = new Date(Date.now() - 6 * 60 * 1000); // 6 minutes ago
      expect(scanner.isAlive()).toBe(false);
    });

    it('should consider scanner dead with no heartbeat', () => {
      scanner.lastHeartbeatAt = null;
      expect(scanner.isAlive()).toBe(false);
    });
  });

  describe('dynamic weight calculation', () => {
    beforeEach(() => {
      scanner.successRate = 90;
      scanner.averageCompletionTimeMs = 10000; // 10 seconds
      scanner.currentActiveJobs = 2;
      scanner.lastHeartbeatAt = new Date();
    });

    it('should calculate weight for high-performing scanner', () => {
      const weight = scanner.calculateWeight();
      expect(weight).toBeGreaterThan(100); // Should be above baseline
    });

    it('should penalize blacklisted scanners', () => {
      scanner.isBlacklisted = true;
      const weight = scanner.calculateWeight();
      expect(weight).toBe(0);
    });

    it('should penalize offline scanners', () => {
      scanner.lastHeartbeatAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      const weight = scanner.calculateWeight();
      expect(weight).toBe(0);
    });

    it('should reduce weight for high load', () => {
      scanner.currentActiveJobs = 10;
      const highLoadWeight = scanner.calculateWeight();
      
      scanner.currentActiveJobs = 1;
      const lowLoadWeight = scanner.calculateWeight();
      
      expect(highLoadWeight).toBeLessThan(lowLoadWeight);
    });
  });
});
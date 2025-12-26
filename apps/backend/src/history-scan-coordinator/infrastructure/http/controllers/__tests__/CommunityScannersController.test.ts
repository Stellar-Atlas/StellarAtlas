import { Request, Response } from 'express';
import { CommunityScannersController } from '../CommunityScannersController';
import { RegisterCommunityScanner } from '../../../../use-cases/RegisterCommunityScanner';
import { SendScannerHeartbeat } from '../../../../use-cases/SendScannerHeartbeat';
import { GetScannerMetrics } from '../../../../use-cases/GetScannerMetrics';
import { CommunityScanner, ScannerStatus } from '../../../database/entities/CommunityScanner';

describe('CommunityScannersController', () => {
  let controller: CommunityScannersController;
  let mockRegisterUseCase: jest.Mocked<RegisterCommunityScanner>;
  let mockHeartbeatUseCase: jest.Mocked<SendScannerHeartbeat>;
  let mockMetricsUseCase: jest.Mocked<GetScannerMetrics>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockRegisterUseCase = {
      execute: jest.fn()
    } as any;

    mockHeartbeatUseCase = {
      execute: jest.fn()
    } as any;

    mockMetricsUseCase = {
      execute: jest.fn()
    } as any;

    controller = new CommunityScannersController(
      mockRegisterUseCase,
      mockHeartbeatUseCase,
      mockMetricsUseCase
    );

    mockRequest = {
      body: {},
      params: {},
      get: jest.fn()
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis()
    };
  });

  describe('register', () => {
    const validRegistrationData = {
      name: 'Test Scanner',
      description: 'A test community scanner',
      contactEmail: 'test@example.com'
    };

    it('should register a new community scanner successfully', async () => {
      const expectedScanner = new CommunityScanner();
      expectedScanner.id = 'scanner-uuid';
      expectedScanner.name = validRegistrationData.name;
      expectedScanner.description = validRegistrationData.description;
      expectedScanner.contactEmail = validRegistrationData.contactEmail;
      expectedScanner.apiKey = 'generated-api-key';
      expectedScanner.status = ScannerStatus.PENDING;

      mockRegisterUseCase.execute.mockResolvedValue(expectedScanner);
      mockRequest.body = validRegistrationData;

      await controller.register(mockRequest as Request, mockResponse as Response);

      expect(mockRegisterUseCase.execute).toHaveBeenCalledWith({
        name: validRegistrationData.name,
        description: validRegistrationData.description,
        contactEmail: validRegistrationData.contactEmail
      });

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: {
          id: expectedScanner.id,
          name: expectedScanner.name,
          description: expectedScanner.description,
          contactEmail: expectedScanner.contactEmail,
          apiKey: expectedScanner.apiKey,
          status: expectedScanner.status,
          createdAt: expectedScanner.createdAt
        }
      });
    });

    it('should return 400 for missing required fields', async () => {
      mockRequest.body = { name: 'Test Scanner' }; // Missing contactEmail

      await controller.register(mockRequest as Request, mockResponse as Response);

      expect(mockRegisterUseCase.execute).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Missing required fields: contactEmail'
      });
    });

    it('should return 400 for invalid email format', async () => {
      mockRequest.body = {
        ...validRegistrationData,
        contactEmail: 'invalid-email'
      };

      await controller.register(mockRequest as Request, mockResponse as Response);

      expect(mockRegisterUseCase.execute).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid email format'
      });
    });

    it('should handle use case errors', async () => {
      mockRegisterUseCase.execute.mockRejectedValue(new Error('Scanner with this email already exists'));
      mockRequest.body = validRegistrationData;

      await controller.register(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Scanner with this email already exists'
      });
    });

    it('should handle unexpected errors', async () => {
      mockRegisterUseCase.execute.mockRejectedValue(new Error('Database connection failed'));
      mockRequest.body = validRegistrationData;

      await controller.register(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Internal server error'
      });
    });
  });

  describe('heartbeat', () => {
    const scannerId = 'scanner-uuid';

    beforeEach(() => {
      mockRequest.params = { id: scannerId };
      mockRequest.get = jest.fn().mockReturnValue('Bearer api-key-123');
    });

    it('should send heartbeat successfully', async () => {
      const updatedScanner = new CommunityScanner();
      updatedScanner.id = scannerId;
      updatedScanner.lastHeartbeatAt = new Date();

      mockHeartbeatUseCase.execute.mockResolvedValue(updatedScanner);

      await controller.heartbeat(mockRequest as Request, mockResponse as Response);

      expect(mockHeartbeatUseCase.execute).toHaveBeenCalledWith({
        scannerId,
        apiKey: 'api-key-123'
      });

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: {
          id: updatedScanner.id,
          lastHeartbeatAt: updatedScanner.lastHeartbeatAt,
          status: updatedScanner.status
        }
      });
    });

    it('should return 401 for missing authorization header', async () => {
      mockRequest.get = jest.fn().mockReturnValue(undefined);

      await controller.heartbeat(mockRequest as Request, mockResponse as Response);

      expect(mockHeartbeatUseCase.execute).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Authorization header required'
      });
    });

    it('should return 401 for invalid authorization format', async () => {
      mockRequest.get = jest.fn().mockReturnValue('Invalid auth header');

      await controller.heartbeat(mockRequest as Request, mockResponse as Response);

      expect(mockHeartbeatUseCase.execute).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid authorization format. Use: Bearer <api-key>'
      });
    });

    it('should handle authentication errors', async () => {
      mockHeartbeatUseCase.execute.mockRejectedValue(new Error('Invalid API key'));

      await controller.heartbeat(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid API key'
      });
    });
  });

  describe('getMetrics', () => {
    it('should return scanner metrics successfully', async () => {
      const mockMetrics = {
        totalScanners: 5,
        activeScanners: 3,
        offlineScanners: 2,
        degradedScanners: 0,
        pendingScanners: 0,
        averageSuccessRate: 85.5,
        totalJobsCompleted: 1250,
        totalJobsFailed: 150,
        averageCompletionTimeMs: 15000
      };

      mockMetricsUseCase.execute.mockResolvedValue(mockMetrics);

      await controller.getMetrics(mockRequest as Request, mockResponse as Response);

      expect(mockMetricsUseCase.execute).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: mockMetrics
      });
    });

    it('should handle metrics retrieval errors', async () => {
      mockMetricsUseCase.execute.mockRejectedValue(new Error('Database error'));

      await controller.getMetrics(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Internal server error'
      });
    });
  });
});
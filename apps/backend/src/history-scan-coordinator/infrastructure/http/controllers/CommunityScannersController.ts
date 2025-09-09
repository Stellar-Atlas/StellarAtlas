import { Request, Response } from 'express';
import { RegisterCommunityScanner } from '../../../use-cases/RegisterCommunityScanner';
import { SendScannerHeartbeat } from '../../../use-cases/SendScannerHeartbeat';
import { GetScannerMetrics } from '../../../use-cases/GetScannerMetrics';

export class CommunityScannersController {
  constructor(
    private readonly registerUseCase: RegisterCommunityScanner,
    private readonly heartbeatUseCase: SendScannerHeartbeat,
    private readonly metricsUseCase: GetScannerMetrics
  ) {}

  async register(req: Request, res: Response): Promise<void> {
    try {
      const { name, description, contactEmail } = req.body;

      // Validate required fields
      const missingFields = [];
      if (!name?.trim()) missingFields.push('name');
      if (!contactEmail?.trim()) missingFields.push('contactEmail');

      if (missingFields.length > 0) {
        res.status(400).json({
          success: false,
          error: `Missing required fields: ${missingFields.join(', ')}`
        });
        return;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactEmail.trim())) {
        res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
        return;
      }

      const scanner = await this.registerUseCase.execute({
        name: name.trim(),
        description: description?.trim() || '',
        contactEmail: contactEmail.trim()
      });

      res.status(201).json({
        success: true,
        data: {
          id: scanner.id,
          name: scanner.name,
          description: scanner.description,
          contactEmail: scanner.contactEmail,
          apiKey: scanner.apiKey,
          status: scanner.status,
          createdAt: scanner.createdAt
        }
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          res.status(400).json({
            success: false,
            error: error.message
          });
          return;
        }
      }

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  async heartbeat(req: Request, res: Response): Promise<void> {
    try {
      const scannerId = req.params.id;
      
      // Extract API key from Authorization header
      const authHeader = req.get('Authorization');
      if (!authHeader) {
        res.status(401).json({
          success: false,
          error: 'Authorization header required'
        });
        return;
      }

      const authParts = authHeader.split(' ');
      if (authParts.length !== 2 || authParts[0] !== 'Bearer') {
        res.status(401).json({
          success: false,
          error: 'Invalid authorization format. Use: Bearer <api-key>'
        });
        return;
      }

      const apiKey = authParts[1];
      const scanner = await this.heartbeatUseCase.execute({
        scannerId,
        apiKey
      });

      res.status(200).json({
        success: true,
        data: {
          id: scanner.id,
          lastHeartbeatAt: scanner.lastHeartbeatAt,
          status: scanner.status
        }
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Invalid API key') || 
            error.message.includes('not found') ||
            error.message.includes('unauthorized')) {
          res.status(401).json({
            success: false,
            error: error.message
          });
          return;
        }
      }

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  async getMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await this.metricsUseCase.execute();

      res.status(200).json({
        success: true,
        data: metrics
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
}
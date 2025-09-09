import { Repository } from 'typeorm';
import { CommunityScanner, ScannerStatus } from '../infrastructure/database/entities/CommunityScanner';

export interface SendHeartbeatRequest {
  scannerId: string;
  apiKey: string;
}

export class SendScannerHeartbeat {
  constructor(private readonly scannerRepository: Repository<CommunityScanner>) {}

  async execute(request: SendHeartbeatRequest): Promise<CommunityScanner> {
    // Find scanner by ID
    const scanner = await this.scannerRepository.findOne({
      where: { id: request.scannerId }
    });

    if (!scanner) {
      throw new Error('Scanner not found');
    }

    // Verify API key
    if (scanner.apiKey !== request.apiKey) {
      throw new Error('Invalid API key');
    }

    // Check if scanner is blacklisted
    if (scanner.isBlacklisted) {
      throw new Error('Scanner is blacklisted');
    }

    // Update heartbeat timestamp
    scanner.updateHeartbeat();

    // Update status based on current state
    if (scanner.status === ScannerStatus.PENDING || scanner.status === ScannerStatus.OFFLINE) {
      scanner.status = ScannerStatus.ONLINE;
    }
    // Note: DEGRADED status should be maintained until performance metrics improve
    // This would be handled by a separate background job that monitors performance

    // Save updated scanner
    return await this.scannerRepository.save(scanner);
  }
}
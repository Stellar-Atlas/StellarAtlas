import { Repository } from 'typeorm';
import { CommunityScanner } from '../infrastructure/database/entities/CommunityScanner';
import { randomBytes } from 'crypto';

export interface RegisterCommunityRequest {
  name: string;
  description?: string;
  contactEmail: string;
}

export class RegisterCommunityScanner {
  constructor(private readonly scannerRepository: Repository<CommunityScanner>) {}

  async execute(request: RegisterCommunityRequest): Promise<CommunityScanner> {
    // Normalize and trim inputs
    const normalizedEmail = request.contactEmail.toLowerCase().trim();
    const trimmedName = request.name.trim();
    const trimmedDescription = request.description?.trim() || '';

    // Check if scanner with this email already exists
    const existingScanner = await this.scannerRepository.findOne({
      where: { contactEmail: normalizedEmail }
    });

    if (existingScanner) {
      throw new Error('Scanner with this email already exists');
    }

    // Generate secure API key
    const apiKey = this.generateApiKey();

    // Create new scanner
    const scanner = this.scannerRepository.create({
      name: trimmedName,
      description: trimmedDescription,
      contactEmail: normalizedEmail,
      apiKey
    });

    // Save to database
    return await this.scannerRepository.save(scanner);
  }

  private generateApiKey(): string {
    // Generate 32 random bytes and convert to hex (64 characters)
    return randomBytes(32).toString('hex');
  }
}
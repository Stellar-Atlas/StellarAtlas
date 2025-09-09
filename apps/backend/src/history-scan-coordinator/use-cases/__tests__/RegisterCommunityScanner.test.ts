import { RegisterCommunityScanner } from '../RegisterCommunityScanner';
import { CommunityScanner, ScannerStatus } from '../../infrastructure/database/entities/CommunityScanner';
import { Repository } from 'typeorm';

describe('RegisterCommunityScanner', () => {
  let useCase: RegisterCommunityScanner;
  let mockRepository: jest.Mocked<Repository<CommunityScanner>>;

  beforeEach(() => {
    mockRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn()
    } as any;

    useCase = new RegisterCommunityScanner(mockRepository);
  });

  const validRequest = {
    name: 'Test Scanner',
    description: 'A test community scanner',
    contactEmail: 'test@example.com'
  };

  it('should register a new community scanner successfully', async () => {
    const expectedScanner = new CommunityScanner();
    expectedScanner.id = 'scanner-uuid';
    expectedScanner.name = validRequest.name;
    expectedScanner.description = validRequest.description;
    expectedScanner.contactEmail = validRequest.contactEmail;
    expectedScanner.apiKey = 'generated-api-key';
    expectedScanner.status = ScannerStatus.PENDING;
    expectedScanner.createdAt = new Date();

    mockRepository.findOne.mockResolvedValue(null); // No existing scanner
    mockRepository.create.mockReturnValue(expectedScanner);
    mockRepository.save.mockResolvedValue(expectedScanner);

    const result = await useCase.execute(validRequest);

    expect(mockRepository.findOne).toHaveBeenCalledWith({
      where: { contactEmail: validRequest.contactEmail }
    });

    expect(mockRepository.create).toHaveBeenCalledWith({
      name: validRequest.name,
      description: validRequest.description,
      contactEmail: validRequest.contactEmail,
      apiKey: expect.stringMatching(/^[a-f0-9]{64}$/) // 64-character hex string
    });

    expect(mockRepository.save).toHaveBeenCalledWith(expectedScanner);
    expect(result).toBe(expectedScanner);
  });

  it('should throw error if scanner with email already exists', async () => {
    const existingScanner = new CommunityScanner();
    existingScanner.contactEmail = validRequest.contactEmail;

    mockRepository.findOne.mockResolvedValue(existingScanner);

    await expect(useCase.execute(validRequest)).rejects.toThrow(
      'Scanner with this email already exists'
    );

    expect(mockRepository.findOne).toHaveBeenCalledWith({
      where: { contactEmail: validRequest.contactEmail }
    });
    expect(mockRepository.create).not.toHaveBeenCalled();
    expect(mockRepository.save).not.toHaveBeenCalled();
  });

  it('should generate unique API keys', async () => {
    mockRepository.findOne.mockResolvedValue(null);
    mockRepository.create.mockImplementation((data) => {
      const scanner = new CommunityScanner();
      Object.assign(scanner, data);
      return scanner;
    });
    mockRepository.save.mockImplementation((scanner) => Promise.resolve(scanner as CommunityScanner));

    const result1 = await useCase.execute(validRequest);
    const result2 = await useCase.execute({
      ...validRequest,
      contactEmail: 'test2@example.com'
    });

    expect(result1.apiKey).not.toBe(result2.apiKey);
    expect(result1.apiKey).toMatch(/^[a-f0-9]{64}$/);
    expect(result2.apiKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should normalize email to lowercase', async () => {
    const requestWithUppercaseEmail = {
      ...validRequest,
      contactEmail: 'TEST@EXAMPLE.COM'
    };

    mockRepository.findOne.mockResolvedValue(null);
    mockRepository.create.mockImplementation((data) => {
      const scanner = new CommunityScanner();
      Object.assign(scanner, data);
      return scanner;
    });
    mockRepository.save.mockImplementation((scanner) => Promise.resolve(scanner as CommunityScanner));

    await useCase.execute(requestWithUppercaseEmail);

    expect(mockRepository.findOne).toHaveBeenCalledWith({
      where: { contactEmail: 'test@example.com' }
    });

    expect(mockRepository.create).toHaveBeenCalledWith({
      name: requestWithUppercaseEmail.name,
      description: requestWithUppercaseEmail.description,
      contactEmail: 'test@example.com',
      apiKey: expect.any(String)
    });
  });

  it('should handle database save errors', async () => {
    mockRepository.findOne.mockResolvedValue(null);
    mockRepository.create.mockReturnValue(new CommunityScanner());
    mockRepository.save.mockRejectedValue(new Error('Database connection failed'));

    await expect(useCase.execute(validRequest)).rejects.toThrow(
      'Database connection failed'
    );
  });

  it('should trim whitespace from inputs', async () => {
    const requestWithWhitespace = {
      name: '  Test Scanner  ',
      description: '  A test community scanner  ',
      contactEmail: '  test@example.com  '
    };

    mockRepository.findOne.mockResolvedValue(null);
    mockRepository.create.mockImplementation((data) => {
      const scanner = new CommunityScanner();
      Object.assign(scanner, data);
      return scanner;
    });
    mockRepository.save.mockImplementation((scanner) => Promise.resolve(scanner as CommunityScanner));

    await useCase.execute(requestWithWhitespace);

    expect(mockRepository.create).toHaveBeenCalledWith({
      name: 'Test Scanner',
      description: 'A test community scanner',
      contactEmail: 'test@example.com',
      apiKey: expect.any(String)
    });
  });
});
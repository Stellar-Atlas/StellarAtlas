import { DataSource } from 'typeorm';
import { CommunityScannerMigration1742387934547 } from '../1742387934547-CommunityScannerMigration';

describe('CommunityScannerMigration1742387934547', () => {
  let dataSource: DataSource;
  let queryRunner: any;
  let migration: CommunityScannerMigration1742387934547;

  beforeEach(() => {
    queryRunner = {
      hasTable: jest.fn(),
      query: jest.fn(),
      manager: {
        query: jest.fn()
      }
    };

    migration = new CommunityScannerMigration1742387934547();
  });

  describe('up', () => {
    it('should create community_scanners table when it does not exist', async () => {
      queryRunner.hasTable.mockResolvedValue(false);

      await migration.up(queryRunner);

      expect(queryRunner.hasTable).toHaveBeenCalledWith('community_scanners');
      
      // Verify table creation
      expect(queryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE "community_scanners"')
      );

      // Verify all required columns are created
      const createTableCall = queryRunner.query.mock.calls.find((call: any[]) => 
        call[0].includes('CREATE TABLE "community_scanners"')
      );
      const createTableQuery = createTableCall[0];

      expect(createTableQuery).toContain('"id" uuid NOT NULL DEFAULT gen_random_uuid()');
      expect(createTableQuery).toContain('"name" varchar(100) NOT NULL');
      expect(createTableQuery).toContain('"description" varchar(500)');
      expect(createTableQuery).toContain('"contact_email" varchar(255) NOT NULL');
      expect(createTableQuery).toContain('"api_key" varchar(255) NOT NULL');
      expect(createTableQuery).toContain('"status" varchar CHECK ("status" IN (\'pending\', \'online\', \'offline\', \'degraded\'))');
      expect(createTableQuery).toContain('"success_rate" decimal(5,2) NOT NULL DEFAULT 0');
      expect(createTableQuery).toContain('"average_completion_time_ms" bigint NOT NULL DEFAULT 0');
      expect(createTableQuery).toContain('"total_jobs_completed" bigint NOT NULL DEFAULT 0');
      expect(createTableQuery).toContain('"total_jobs_failed" bigint NOT NULL DEFAULT 0');
      expect(createTableQuery).toContain('"current_active_jobs" integer NOT NULL DEFAULT 0');
      expect(createTableQuery).toContain('"is_blacklisted" boolean NOT NULL DEFAULT false');
      expect(createTableQuery).toContain('"blacklisted_until" timestamp');
      expect(createTableQuery).toContain('"last_heartbeat_at" timestamp');
      expect(createTableQuery).toContain('"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()');
      expect(createTableQuery).toContain('"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()');

      // Verify constraints
      expect(createTableQuery).toContain('CONSTRAINT "PK_community_scanners_id" PRIMARY KEY ("id")');
      expect(createTableQuery).toContain('CONSTRAINT "UQ_community_scanners_api_key" UNIQUE ("api_key")');

      // Verify indexes are created
      expect(queryRunner.query).toHaveBeenCalledWith(
        'CREATE INDEX "IDX_community_scanners_id" ON "community_scanners" ("id")'
      );
      expect(queryRunner.query).toHaveBeenCalledWith(
        'CREATE UNIQUE INDEX "IDX_community_scanners_api_key" ON "community_scanners" ("api_key")'
      );
      expect(queryRunner.query).toHaveBeenCalledWith(
        'CREATE INDEX "IDX_community_scanners_status" ON "community_scanners" ("status")'
      );
      expect(queryRunner.query).toHaveBeenCalledWith(
        'CREATE INDEX "IDX_community_scanners_last_heartbeat" ON "community_scanners" ("last_heartbeat_at")'
      );
      expect(queryRunner.query).toHaveBeenCalledWith(
        'CREATE INDEX "IDX_community_scanners_blacklisted" ON "community_scanners" ("is_blacklisted")'
      );
      expect(queryRunner.query).toHaveBeenCalledWith(
        'CREATE INDEX "IDX_community_scanners_email" ON "community_scanners" ("contact_email")'
      );
    });

    it('should skip creation if community_scanners table already exists', async () => {
      queryRunner.hasTable.mockResolvedValue(true);

      await migration.up(queryRunner);

      expect(queryRunner.hasTable).toHaveBeenCalledWith('community_scanners');
      expect(queryRunner.query).not.toHaveBeenCalled();
    });
  });

  describe('down', () => {
    it('should drop community_scanners table and indexes when table exists', async () => {
      queryRunner.hasTable.mockResolvedValue(true);

      await migration.down(queryRunner);

      expect(queryRunner.hasTable).toHaveBeenCalledWith('community_scanners');

      // Verify indexes are dropped first
      expect(queryRunner.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "IDX_community_scanners_email"');
      expect(queryRunner.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "IDX_community_scanners_blacklisted"');
      expect(queryRunner.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "IDX_community_scanners_last_heartbeat"');
      expect(queryRunner.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "IDX_community_scanners_status"');
      expect(queryRunner.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "IDX_community_scanners_api_key"');
      expect(queryRunner.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "IDX_community_scanners_id"');

      // Verify table is dropped
      expect(queryRunner.query).toHaveBeenCalledWith('DROP TABLE "community_scanners"');
    });

    it('should skip dropping if community_scanners table does not exist', async () => {
      queryRunner.hasTable.mockResolvedValue(false);

      await migration.down(queryRunner);

      expect(queryRunner.hasTable).toHaveBeenCalledWith('community_scanners');
      expect(queryRunner.query).not.toHaveBeenCalled();
    });
  });

  it('should have correct migration name', () => {
    expect(migration.name).toBe('CommunityScannerMigration1742387934547');
  });
});
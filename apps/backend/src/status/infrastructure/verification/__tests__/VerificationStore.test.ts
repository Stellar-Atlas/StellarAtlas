import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { TypeOrmVerificationStore } from '../TypeOrmVerificationStore.js';
import { AtlasAccountVerification1794091000000 } from '../../../../core/infrastructure/database/migrations/1794091000000-AtlasAccountVerification.js';
import type { Application } from '../VerificationApplication.js';

const application: Application = {
	id: '00000001-0000-0000-0000-000000000001',
	applicantId: 'owner',
	network: 'mainnet',
	address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
	name: 'Name',
	website: 'https://example.org/',
	supportingEvidence: 'private',
	control: {
		subjectId: 'owner',
		network: 'mainnet',
		address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		method: 'stellar-account-authority',
		verifiedAt: '2026-11-07T22:00:00Z',
		reference: 'authority'
	},
	state: 'pending',
	revision: 1,
	submittedAt: '2026-11-07T22:00:00Z',
	updatedAt: '2026-11-07T22:00:00Z',
	review: null
};
function fixture(rows: unknown[] = [{ id: application.id, count: 0 }]) {
	const query = jest.fn(async (_sql: string, _parameters?: unknown[]) => rows);
	const transaction = jest.fn(
		async (work: (manager: EntityManager) => Promise<void>) =>
			work({ query } as unknown as EntityManager)
	);
	const database = { transaction, query } as unknown as DataSource;
	return { query, transaction, store: new TypeOrmVerificationStore(database) };
}
it('stores a new application and audit event in one bounded transaction using parameters', async () => {
	const f = fixture();
	await f.store.create(application, {
		actor: 'owner',
		action: 'submitted',
		application
	});
	expect(f.transaction).toHaveBeenCalledTimes(1);
	const sql = f.query.mock.calls.map((call) => call[0]);
	expect(sql).toEqual(
		expect.arrayContaining([
			expect.stringContaining('pg_advisory_xact_lock'),
			expect.stringContaining("interval '1 day'"),
			expect.stringContaining('INSERT INTO atlas_verification_application'),
			expect.stringContaining('INSERT INTO atlas_verification_event')
		])
	);
	expect(sql.join(' ')).not.toContain(application.supportingEvidence);
	expect(sql[0]).toContain('lock_timeout');
	expect(sql[1]).toContain('statement_timeout');
});
it('does not append an audit event when a concurrent update wins', async () => {
	const f = fixture([]);
	await expect(
		f.store.update(
			1,
			{ ...application, revision: 2 },
			{ actor: 'owner', action: 'resubmitted', application }
		)
	).rejects.toMatchObject({ status: 409 });
	expect(
		f.query.mock.calls.some((call) =>
			call[0].includes('INSERT INTO atlas_verification_event')
		)
	).toBe(false);
	expect(
		f.query.mock.calls.find((call) => call[0].includes('UPDATE'))?.[1]?.at(-1)
	).toBe(1);
});
it('enforces per-applicant daily admission inside the transaction', async () => {
	const f = fixture([{ count: 5 }]);
	await expect(
		f.store.create(application, {
			actor: 'owner',
			action: 'submitted',
			application
		})
	).rejects.toMatchObject({ status: 409 });
	expect(f.query.mock.calls.some((call) => call[0].includes('INSERT'))).toBe(
		false
	);
});
it('requires transactional additive DDL and a unique approved identity for each network/account', async () => {
	const migration = new AtlasAccountVerification1794091000000();
	await expect(
		migration.up({ isTransactionActive: false } as QueryRunner)
	).rejects.toThrow('transaction');
	const query = jest.fn(async (_sql: string) => undefined);
	await migration.up({
		isTransactionActive: true,
		query
	} as unknown as QueryRunner);
	const sql = query.mock.calls.map((call) => call[0]).join(' ');
	expect(sql.match(/CREATE TABLE/g)).toHaveLength(2);
	expect(sql).toContain("WHERE state='approved'");
	expect(sql).toContain('UNIQUE (applicant_id, network, address)');
	expect(sql).not.toMatch(/DROP |expert_directory/);
});

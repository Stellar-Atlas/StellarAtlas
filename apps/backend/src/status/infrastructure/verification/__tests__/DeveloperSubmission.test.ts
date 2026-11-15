import { Networks, StrKey } from '@stellar/stellar-sdk';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import type { ContractProvenance } from '../../http/contract-provenance/ContractProvenanceService.js';
import { AtlasDeveloperSubmissions1794744000000 } from '../../../../core/infrastructure/database/migrations/1794744000000-AtlasDeveloperSubmissions.js';
import {
	developerSubmissionResult,
	parseDeveloperSubmission,
	projectDeveloperSubmission,
	type DeveloperSubmission
} from '../DeveloperSubmission.js';
import { TypeOrmDeveloperSubmissionStore } from '../TypeOrmDeveloperSubmissionStore.js';

const request = {
	contractId: StrKey.encodeContract(Buffer.alloc(32, 7)),
	repository: 'example/contract',
	commit: 'a'.repeat(40)
};
const record = {
	repository: request.repository,
	commit: request.commit,
	sourceUrl: 'https://github.com/example/contract/tree/' + request.commit,
	workflowUrl:
		'https://github.com/example/contract/actions/workflows/build.yml',
	runUrl: null,
	attestationUrl: 'https://api.github.com/repos/example/contract/attestations'
};
const evidence: ContractProvenance = {
	contractId: request.contractId,
	networkPassphrase: Networks.PUBLIC,
	observedLedger: 42,
	instanceModifiedLedger: 40,
	checkedAt: new Date().toISOString(),
	executable: 'wasm',
	wasmSha256: 'b'.repeat(64),
	metadata: { sourceRepository: request.repository, homeDomain: null },
	build: { status: 'verified', record },
	securityAudit: 'not_assessed'
};
const id = '6caad803-bb79-483f-8068-e04e79ab76fc';
const key = '2beb8b84-ac09-4a94-b27f-7332f05641f1';
const row = {
	id,
	user_id: '1234567',
	idempotency_key: key,
	request,
	network_passphrase: Networks.PUBLIC,
	created_at: new Date(),
	expires_at: new Date(Date.now() + 86_400_000),
	status: 'checking',
	result: null
};

function storage(query: jest.Mock) {
	const database = {
		transaction: jest.fn(
			async (work: (manager: EntityManager) => Promise<unknown>) =>
				work({ query } as unknown as EntityManager)
		)
	} as unknown as DataSource;
	return new TypeOrmDeveloperSubmissionStore(database);
}

it('accepts only the bounded contract, repository and exact commit request', () => {
	expect(
		parseDeveloperSubmission({ ...request, repository: 'Example/Contract' })
	).toEqual(request);
	for (const invalid of [
		{ ...request, contractId: 'G' + 'A'.repeat(55) },
		{ ...request, commit: 'main' },
		{ ...request, repository: 'https://github.com/example/contract' },
		{ ...request, repository: 'example/..' },
		{ ...request, command: 'cargo build' },
		{ ...request, network: 'testnet' },
		{ ...request, userId: '123' }
	])
		expect(() => parseDeveloperSubmission(invalid)).toThrow(
			'invalid_submission'
		);
});

it('requires the observed contract, network, repository and commit before reporting a match', () => {
	expect(developerSubmissionResult(request, Networks.PUBLIC, evidence)).toEqual(
		{ status: 'verified', evidence }
	);
	expect(
		developerSubmissionResult(
			{ ...request, commit: 'c'.repeat(40) },
			Networks.PUBLIC,
			evidence
		).status
	).toBe('source_mismatch');
	expect(
		developerSubmissionResult(
			{ ...request, repository: 'other/repository' },
			Networks.PUBLIC,
			evidence
		).status
	).toBe('source_mismatch');
	expect(() =>
		developerSubmissionResult(request, Networks.TESTNET, evidence)
	).toThrow('does not match');
	for (const status of [
		'not_published',
		'unsupported',
		'invalid',
		'unavailable'
	] as const) {
		const observation = { ...evidence, build: { status, record: null } };
		expect(
			developerSubmissionResult(request, Networks.PUBLIC, observation)
		).toEqual({ status, evidence: observation });
	}
});

it('projects an interrupted request as unavailable after its bounded check window', () => {
	const checking: DeveloperSubmission = {
		id,
		submittedAt: new Date(Date.now() - 121_000).toISOString(),
		expiresAt: row.expires_at.toISOString(),
		request,
		networkPassphrase: Networks.PUBLIC,
		status: 'checking',
		result: null,
		contractOwnership: 'not_assessed',
		independentReproduction: 'not_assessed',
		securityAudit: 'not_assessed'
	};
	expect(projectDeveloperSubmission(checking)).toMatchObject({
		status: 'unavailable',
		result: { status: 'unavailable', evidence: null }
	});
});

it('locks shared admission, saves the server-bound owner and replays only an identical request', async () => {
	let existing = false;
	const query = jest.fn(async (sql: string, _values?: readonly unknown[]) => {
		if (sql === 'SHOW transaction_read_only')
			return [{ transaction_read_only: 'off' }];
		if (sql.includes('SELECT * FROM atlas_developer_submission'))
			return existing ? [row] : [];
		if (sql.includes(' AS full')) return [{ full: false }];
		if (sql.includes('INSERT INTO atlas_developer_submission')) return [row];
		return [];
	});
	const store = storage(query);
	expect(
		await store.create('github:1234567', key, request, Networks.PUBLIC)
	).toMatchObject({
		created: true,
		submission: { id, request, status: 'checking' }
	});
	const inserted = query.mock.calls.find(([sql]) =>
		String(sql).includes('INSERT INTO atlas_developer_submission')
	);
	expect(inserted?.[1]).toEqual([
		expect.any(String),
		'1234567',
		key,
		Networks.PUBLIC,
		JSON.stringify(request),
		30
	]);
	expect(
		query.mock.calls.findIndex(([sql]) =>
			String(sql).includes('pg_advisory_xact_lock')
		)
	).toBeLessThan(
		query.mock.calls.findIndex(([sql]) =>
			String(sql).includes('INSERT INTO atlas_developer_submission')
		)
	);
	existing = true;
	query.mockClear();
	expect(
		await store.create('github:1234567', key, request, Networks.PUBLIC)
	).toMatchObject({ created: false });
	expect(
		query.mock.calls.some(([sql]) =>
			String(sql).includes('INSERT INTO atlas_developer_submission')
		)
	).toBe(false);
	await expect(
		store.create(
			'github:1234567',
			key,
			{ ...request, commit: 'e'.repeat(40) },
			Networks.PUBLIC
		)
	).rejects.toThrow('idempotency_conflict');
});

it('scopes every read and completion to the server-side owner and suppresses private columns', async () => {
	const query = jest.fn(async (sql: string, values?: readonly unknown[]) => {
		if (sql === 'SHOW transaction_read_only')
			return [{ transaction_read_only: 'off' }];
		if (sql.includes('SELECT * FROM atlas_developer_submission'))
			return values?.[1] === row.user_id ? [row] : [];
		if (sql.includes('UPDATE atlas_developer_submission'))
			return [
				[
					{
						...row,
						status: 'completed',
						result: { status: 'verified', evidence }
					}
				],
				1
			];
		return [];
	});
	const store = storage(query);
	expect(await store.read('github:7654321', id)).toBeNull();
	expect(await store.read('github:1234567', id)).toMatchObject({ id, request });
	const completed = await store.finish('github:1234567', id, {
		status: 'verified',
		evidence
	});
	expect(completed).not.toHaveProperty('user_id');
	expect(completed).not.toHaveProperty('idempotency_key');
	const update = query.mock.calls.find(([sql]) =>
		String(sql).includes('UPDATE atlas_developer_submission')
	);
	expect(update?.[0]).toContain("id=$1 AND user_id=$2 AND status='checking'");
	expect(update?.[1]?.slice(0, 3)).toEqual([id, '1234567', 'completed']);
	await expect(store.read('stellar:1234567', id)).rejects.toThrow(
		'sign_in_required'
	);
});

it('rejects exhausted shared admission and refuses a read-only write context', async () => {
	const query = jest.fn(async (sql: string) => {
		if (sql === 'SHOW transaction_read_only')
			return [{ transaction_read_only: 'off' }];
		if (sql.includes(' AS full')) return [{ full: true }];
		return [];
	});
	const store = storage(query);
	await expect(
		store.create('github:1234567', key, request, Networks.PUBLIC)
	).rejects.toThrow('submission_busy');
	expect(
		query.mock.calls.some(([sql]) =>
			String(sql).includes('INSERT INTO atlas_developer_submission')
		)
	).toBe(false);
	const readOnly = storage(
		jest.fn(async () => [{ transaction_read_only: 'on' }])
	);
	await expect(
		readOnly.create('github:1234567', key, request, Networks.PUBLIC)
	).rejects.toThrow('writable storage');
});

it('registers a transaction-required source table with owner and idempotency constraints', async () => {
	const query = jest.fn().mockResolvedValue([]);
	const migration = new AtlasDeveloperSubmissions1794744000000();
	await expect(
		migration.up({
			isTransactionActive: false,
			query
		} as unknown as QueryRunner)
	).rejects.toThrow('requires a transaction');
	expect(query).not.toHaveBeenCalled();
	await migration.up({
		isTransactionActive: true,
		query
	} as unknown as QueryRunner);
	const sql = query.mock.calls.map(([value]) => String(value)).join('\n');
	expect(sql).toContain('REFERENCES atlas_developer_github_principal(user_id)');
	expect(sql).toContain('UNIQUE (user_id,idempotency_key)');
	expect(sql).toContain('octet_length(result::text)<=16384');
});

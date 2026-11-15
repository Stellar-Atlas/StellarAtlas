import express from 'express';
import supertest from 'supertest';
import type { DataSource } from 'typeorm';
import { developerAuthPath } from '../DeveloperGithubOAuth.js';

const { jest: mocks } = import.meta as ImportMeta & { jest: typeof jest };
const readProtectedVerificationCredential = mocks.fn(() => 'synthetic-secret');
mocks.unstable_mockModule('../ProtectedVerificationCredential.js', () => ({
	readProtectedVerificationCredential
}));
const { createAtlasDeveloperAuth, developerGithubSecretFile } =
	await import('../DeveloperAuthActivation.js');

const config = {
	ATLAS_DEVELOPER_AUTH_GITHUB_ENABLED: 'true',
	ATLAS_DEVELOPER_AUTH_INGRESS_REDACTED: 'true',
	ATLAS_DEVELOPER_AUTH_ORIGIN: 'https://atlas.example',
	ATLAS_DEVELOPER_AUTH_GITHUB_CLIENT_ID: 'synthetic-client',
	ATLAS_DEVELOPER_AUTH_GITHUB_CLIENT_SECRET_FILE: developerGithubSecretFile
};

beforeEach(() => readProtectedVerificationCredential.mockClear());

it('is disabled by default without touching storage or credentials', async () => {
	const transaction = jest.fn();
	const database = { transaction } as unknown as DataSource;
	await expect(createAtlasDeveloperAuth({}, database)).resolves.toBeNull();
	await expect(
		createAtlasDeveloperAuth(
			{
				...config,
				ATLAS_DEVELOPER_AUTH_GITHUB_ENABLED: 'false'
			},
			database
		)
	).resolves.toBeNull();
	expect(transaction).not.toHaveBeenCalled();
	expect(readProtectedVerificationCredential).not.toHaveBeenCalled();
});

it('requires explicit ingress redaction and a pinned credential path before startup', async () => {
	const transaction = jest.fn();
	const database = { transaction } as unknown as DataSource;
	await expect(
		createAtlasDeveloperAuth(
			{
				...config,
				ATLAS_DEVELOPER_AUTH_INGRESS_REDACTED: 'false'
			},
			database
		)
	).rejects.toThrow('validated ingress redaction');
	await expect(
		createAtlasDeveloperAuth(
			{
				...config,
				ATLAS_DEVELOPER_AUTH_GITHUB_CLIENT_SECRET_FILE: 'arbitrary-file'
			},
			database
		)
	).rejects.toThrow('explicit GitHub credentials');
	expect(transaction).not.toHaveBeenCalled();
	expect(readProtectedVerificationCredential).not.toHaveBeenCalled();
});

it('exposes no-store capabilities only after writable storage admission', async () => {
	const query = jest
		.fn()
		.mockResolvedValueOnce([{ transaction_read_only: 'off' }])
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([{ ready: true }]);
	const transaction = jest.fn((run: (manager: unknown) => unknown) =>
		run({ query })
	);
	const database = { transaction } as unknown as DataSource;
	const provider = mocks.fn<
		ReturnType<typeof fetch>,
		Parameters<typeof fetch>
	>();
	const router = await createAtlasDeveloperAuth(config, database, provider);
	expect(router).not.toBeNull();
	expect(query).toHaveBeenNthCalledWith(1, 'SHOW transaction_read_only');
	await supertest(express().use(developerAuthPath, router!))
		.get(developerAuthPath + '/capabilities')
		.expect('Cache-Control', 'private, no-store')
		.expect(200, { available: true, provider: 'github' });
	await expect(
		createAtlasDeveloperAuth(config, database, provider)
	).rejects.toThrow('protected GitHub credentials and writable storage');
	expect(readProtectedVerificationCredential).toHaveBeenCalledWith(
		developerGithubSecretFile,
		257
	);
	expect(provider).not.toHaveBeenCalled();
});

it('refuses read-only transactions before checking table privileges', async () => {
	const query = jest.fn().mockResolvedValue([{ transaction_read_only: 'on' }]);
	const transaction = jest.fn((run: (manager: unknown) => unknown) =>
		run({ query })
	);
	const database = { transaction } as unknown as DataSource;
	await expect(createAtlasDeveloperAuth(config, database)).rejects.toThrow(
		'protected GitHub credentials and writable storage'
	);
	expect(query.mock.calls).toEqual([['SHOW transaction_read_only']]);
});

it('keeps saved submissions off independently and admits them only with writable schema and a verifier', async () => {
	const query = jest.fn(async (sql: string) => {
		if (sql === 'SHOW transaction_read_only')
			return [{ transaction_read_only: 'off' }];
		if (sql.includes('AS ready')) return [{ ready: true }];
		return [];
	});
	const transaction = jest.fn((run: (manager: unknown) => unknown) =>
		run({ query })
	);
	const database = { transaction } as unknown as DataSource;
	const verifier = { get: mocks.fn() };
	const verification = {
		networkPassphrase: 'Public Global Stellar Network ; September 2015',
		verifier
	};
	const disabled = await createAtlasDeveloperAuth(
		config,
		database,
		undefined,
		verification
	);
	await supertest(express().use(developerAuthPath, disabled!))
		.get(developerAuthPath + '/submissions/capabilities')
		.expect(404);
	await expect(
		createAtlasDeveloperAuth(
			{
				...config,
				ATLAS_DEVELOPER_SUBMISSIONS_ENABLED: 'true'
			},
			database
		)
	).rejects.toThrow('configured contract verifier');
	const enabled = await createAtlasDeveloperAuth(
		{
			...config,
			ATLAS_DEVELOPER_SUBMISSIONS_ENABLED: 'true'
		},
		database,
		undefined,
		verification
	);
	const api = supertest(express().use(developerAuthPath, enabled!));
	await api.get(developerAuthPath + '/submissions/capabilities').expect(200, {
		available: true,
		verification: 'published_build_attestation',
		retentionDays: 30
	});
	await api
		.get(
			developerAuthPath + '/submissions/6caad803-bb79-483f-8068-e04e79ab76fc'
		)
		.expect(401, { code: 'sign_in_required' });
	expect(
		query.mock.calls.some(([sql]) => sql.includes('atlas_developer_submission'))
	).toBe(true);
	expect(verifier.get).not.toHaveBeenCalled();
});

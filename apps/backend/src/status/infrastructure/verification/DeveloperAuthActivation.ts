import type { Router } from 'express';
import type { DataSource } from 'typeorm';
import { developerAuthRouter } from './DeveloperAuthRouter.js';
import { readProtectedVerificationCredential } from './ProtectedVerificationCredential.js';
import { TypeOrmDeveloperAuthStore } from './TypeOrmDeveloperAuthStore.js';

export const developerGithubSecretFile =
	'/etc/stellaratlas/developer-auth/github.client-secret';

export async function createAtlasDeveloperAuth(
	environment: NodeJS.ProcessEnv,
	database: DataSource,
	request?: typeof fetch
): Promise<Router | null> {
	const enabled = environment.ATLAS_DEVELOPER_AUTH_GITHUB_ENABLED;
	if (enabled === undefined || enabled === 'false') return null;
	if (enabled !== 'true')
		throw new Error(
			'ATLAS_DEVELOPER_AUTH_GITHUB_ENABLED must be true or false'
		);
	// The origin proxy must redact callback queries, cookies, and provider
	// credentials before the request reaches the application. This explicit
	// deployment admission follows validation at the exact public origin.
	if (environment.ATLAS_DEVELOPER_AUTH_INGRESS_REDACTED !== 'true')
		throw new Error(
			'Developer authentication requires validated ingress redaction'
		);
	const origin = environment.ATLAS_DEVELOPER_AUTH_ORIGIN;
	const clientId = environment.ATLAS_DEVELOPER_AUTH_GITHUB_CLIENT_ID;
	if (
		!origin ||
		!clientId ||
		environment.ATLAS_DEVELOPER_AUTH_GITHUB_CLIENT_SECRET_FILE !==
			developerGithubSecretFile
	)
		throw new Error(
			'Developer authentication requires explicit GitHub credentials and HTTPS origin'
		);
	try {
		const clientSecret = readProtectedVerificationCredential(
			developerGithubSecretFile,
			257
		);
		const store = new TypeOrmDeveloperAuthStore(database, clientSecret);
		const { router } = developerAuthRouter(
			{ origin, clientId, clientSecret },
			store,
			request
		);
		await store.assertReady();
		return router;
	} catch {
		throw new Error(
			'Developer authentication requires protected GitHub credentials and writable storage'
		);
	}
}

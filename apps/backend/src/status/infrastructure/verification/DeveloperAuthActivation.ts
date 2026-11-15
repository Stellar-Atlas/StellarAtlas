import type { Router } from 'express';
import type { DataSource } from 'typeorm';
import { developerAuthRouter } from './DeveloperAuthRouter.js';
import { readProtectedVerificationCredential } from './ProtectedVerificationCredential.js';
import { TypeOrmDeveloperAuthStore } from './TypeOrmDeveloperAuthStore.js';
import { developerSubmissionRouter } from './DeveloperSubmissionRouter.js';
import { TypeOrmDeveloperSubmissionStore } from './TypeOrmDeveloperSubmissionStore.js';
import type { ContractProvenanceService } from '../http/contract-provenance/ContractProvenanceService.js';

export const developerGithubSecretFile =
	'/etc/stellaratlas/developer-auth/github.client-secret';

export async function createAtlasDeveloperAuth(
	environment: NodeJS.ProcessEnv,
	database: DataSource,
	request?: typeof fetch,
	verification?: {
		readonly networkPassphrase: string;
		readonly verifier: Pick<ContractProvenanceService, 'get'>;
	}
): Promise<Router | null> {
	const enabled = environment.ATLAS_DEVELOPER_AUTH_GITHUB_ENABLED;
	const submissions = environment.ATLAS_DEVELOPER_SUBMISSIONS_ENABLED;
	if (
		submissions !== undefined &&
		submissions !== 'false' &&
		submissions !== 'true'
	)
		throw new Error(
			'ATLAS_DEVELOPER_SUBMISSIONS_ENABLED must be true or false'
		);
	if (submissions === 'true' && (enabled !== 'true' || !verification))
		throw new Error(
			'Developer submissions require GitHub authentication and the configured contract verifier'
		);
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
		const { router, applicant } = developerAuthRouter(
			{ origin, clientId, clientSecret },
			store,
			request
		);
		await store.assertReady();
		if (submissions === 'true' && verification) {
			const submissionsStore = new TypeOrmDeveloperSubmissionStore(database);
			await submissionsStore.assertReady();
			router.use(
				developerSubmissionRouter({
					origin,
					applicant,
					store: submissionsStore,
					...verification
				})
			);
		}
		return router;
	} catch {
		throw new Error(
			'Developer authentication requires protected GitHub credentials and writable storage'
		);
	}
}

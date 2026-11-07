import type { DataSource } from 'typeorm';
import { TypeOrmVerificationStore } from './TypeOrmVerificationStore.js';
import {
	verificationRouter,
	type VerificationBoundary
} from './VerificationRouter.js';
import { VerificationWorkflow } from './VerificationWorkflow.js';
import express from 'express';
import { verificationAuthConfig } from './VerificationAuthConfig.js';
import { createAuthorityReader } from './VerificationAuthority.js';
import { TypeOrmVerificationAuthStore } from './VerificationAuthStore.js';
import { VerificationStellarAuth } from './VerificationStellarAuth.js';
import { verificationAuthRouter } from './VerificationAuthRouter.js';

export function createAtlasVerification(
	environment: NodeJS.ProcessEnv,
	dataSource: DataSource,
	boundary?: VerificationBoundary
) {
	const flag = environment.ATLAS_VERIFICATION_ENABLED;
	if (flag !== undefined && flag !== 'false' && flag !== 'true')
		throw new Error('ATLAS_VERIFICATION_ENABLED must be true or false');
	if (flag === 'true' && !boundary) {
		const { config, endpoints } = verificationAuthConfig(environment);
		const auth = new VerificationStellarAuth(
			config,
			new TypeOrmVerificationAuthStore(dataSource),
			createAuthorityReader(endpoints)
		);
		const router = express.Router();
		router.get('/capabilities', (_req, res) =>
			res.set('Cache-Control', 'private, no-store').json({
				available: true,
				authentication: 'stellar-challenge',
				networks: [...config.networks],
				accountControlRequired: true,
				identityReviewRequired: true
			})
		);
		router.use('/auth', verificationAuthRouter(auth));
		router.use(
			verificationRouter({
				enabled: true,
				boundary: auth,
				workflow: new VerificationWorkflow(
					new TypeOrmVerificationStore(dataSource)
				)
			})
		);
		return router;
	}
	return verificationRouter({
		enabled: flag === 'true',
		boundary,
		workflow: new VerificationWorkflow(new TypeOrmVerificationStore(dataSource))
	});
}

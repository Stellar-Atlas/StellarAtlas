import type { DataSource } from 'typeorm';
import { TypeOrmVerificationStore } from './TypeOrmVerificationStore.js';
import {
	verificationRouter,
	type VerificationBoundary
} from './VerificationRouter.js';
import { VerificationWorkflow } from './VerificationWorkflow.js';

export function createAtlasVerification(
	environment: NodeJS.ProcessEnv,
	dataSource: DataSource,
	boundary?: VerificationBoundary
) {
	const flag = environment.ATLAS_VERIFICATION_ENABLED;
	if (flag !== undefined && flag !== 'false' && flag !== 'true')
		throw new Error('ATLAS_VERIFICATION_ENABLED must be true or false');
	return verificationRouter({
		enabled: flag === 'true',
		boundary,
		workflow: new VerificationWorkflow(new TypeOrmVerificationStore(dataSource))
	});
}

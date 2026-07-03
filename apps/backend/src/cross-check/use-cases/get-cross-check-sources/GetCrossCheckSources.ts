import 'reflect-metadata';
import { injectable } from 'inversify';
import { ok, Result } from 'neverthrow';
import type {
	CrossCheckSourceDTO,
	CrossCheckSourcesDTO
} from '../../domain/CrossCheckSource.js';

type CrossCheckSourceDefinition = Omit<CrossCheckSourceDTO, 'probe'>;

const sourceDefinitions: readonly CrossCheckSourceDefinition[] = [
	{
		description:
			'Primary StellarAtlas persisted network, archive, status, and SCP observation APIs.',
		documentationUrl: '/docs',
		id: 'stellaratlas-api',
		kind: 'internal',
		name: 'StellarAtlas Public API',
		scopes: ['validators', 'organizations', 'archives'],
		url: '/v1'
	},
	{
		description:
			'Legacy RADAR/Stellarbeat reference surface for non-adversarial parity review.',
		documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
		id: 'withobsrvr-radar',
		kind: 'external',
		name: 'Obsrvr RADAR',
		scopes: ['validators', 'organizations', 'archives'],
		url: 'https://radar.withobsrvr.com/'
	}
];

@injectable()
export class GetCrossCheckSources {
	execute(): Result<CrossCheckSourcesDTO, Error> {
		return ok({
			generatedAt: new Date().toISOString(),
			probe: 'not_run',
			sources: sourceDefinitions.map(mapSourceDefinition)
		});
	}
}

function mapSourceDefinition(
	source: CrossCheckSourceDefinition
): CrossCheckSourceDTO {
	return {
		...source,
		probe: 'not_run',
		scopes: [...source.scopes]
	};
}

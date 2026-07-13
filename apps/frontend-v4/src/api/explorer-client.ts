import { fetchValidatedJson, type FetchOptions } from './client';
import type { PublicExplorerLocalReadModel } from './explorer-types';
import { parseExplorerLocalReadModel } from './explorer-local-read-model-contract';

export const fetchExplorerLocalReadModel = (
	options?: FetchOptions
): Promise<PublicExplorerLocalReadModel> =>
	fetchValidatedJson<PublicExplorerLocalReadModel>(
		'/v1/explorer/local-read-model',
		parseExplorerLocalReadModel,
		options
	);

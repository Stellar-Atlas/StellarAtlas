import { fetchJson, type FetchOptions } from './client';
import type { PublicExplorerLocalReadModel } from './explorer-types';

export const fetchExplorerLocalReadModel = (
	options?: FetchOptions
): Promise<PublicExplorerLocalReadModel> =>
	fetchJson<PublicExplorerLocalReadModel>(
		'/v1/explorer/local-read-model',
		options
	);

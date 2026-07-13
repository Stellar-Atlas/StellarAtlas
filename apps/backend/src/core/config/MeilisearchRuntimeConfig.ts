import {
	defaultMeilisearchNetworkIndex,
	defaultMeilisearchScpStatementIndex
} from './SearchConfigDefaults.js';

type Environment = Readonly<Record<string, string | undefined>>;

export interface MeilisearchWorkloadConfig {
	readonly apiKey?: string;
	readonly host?: string;
	readonly indexName: string;
}

export interface MeilisearchNetworkWorkloadConfig extends MeilisearchWorkloadConfig {
	readonly writable: boolean;
}

export interface MeilisearchRuntimeConfig {
	readonly network: MeilisearchNetworkWorkloadConfig;
	readonly scp: MeilisearchWorkloadConfig;
}

const optionalValue = (value: string | undefined): string | undefined => {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

export const parseMeilisearchRuntimeConfig = (
	environment: Environment
): MeilisearchRuntimeConfig => {
	const legacyApiKey = optionalValue(environment.MEILISEARCH_API_KEY);
	const legacyHost = optionalValue(environment.MEILISEARCH_HOST);
	const networkHost = optionalValue(environment.MEILISEARCH_NETWORK_HOST);

	return {
		network: {
			apiKey: networkHost
				? optionalValue(environment.MEILISEARCH_NETWORK_API_KEY)
				: undefined,
			host: networkHost,
			indexName:
				optionalValue(environment.MEILISEARCH_NETWORK_INDEX) ??
				defaultMeilisearchNetworkIndex,
			writable:
				networkHost !== undefined &&
				environment.API_SEARCH_PROJECTION_WRITER !== 'false'
		},
		scp: {
			apiKey:
				optionalValue(environment.MEILISEARCH_SCP_API_KEY) ?? legacyApiKey,
			host: optionalValue(environment.MEILISEARCH_SCP_HOST) ?? legacyHost,
			indexName:
				optionalValue(environment.MEILISEARCH_SCP_STATEMENT_INDEX) ??
				defaultMeilisearchScpStatementIndex
		}
	};
};

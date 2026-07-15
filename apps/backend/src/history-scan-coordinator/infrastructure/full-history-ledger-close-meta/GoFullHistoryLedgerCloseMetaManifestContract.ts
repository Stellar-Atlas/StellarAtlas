import {
	FULL_HISTORY_LEDGER_CLOSE_META_CORE_DATASETS,
	FULL_HISTORY_LEDGER_CLOSE_META_DATASETS,
	FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS,
	type FullHistoryLedgerCloseMetaDatasetOutput
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';

const manifestVersionV6 = 'stellar-atlas.full-history-etl.manifest.v6' as const;
const manifestVersionV7 = 'stellar-atlas.full-history-etl.manifest.v7' as const;
const manifestVersionV8 = 'stellar-atlas.full-history-etl.manifest.v8' as const;

export type GoFullHistoryLedgerCloseMetaManifestVersion =
	| typeof manifestVersionV6
	| typeof manifestVersionV7
	| typeof manifestVersionV8;

const unsupportedV7 = [
	'ledger-close-upgrades-and-extension-values',
	'transaction-envelope-details',
	'operation-result-details',
	'effects',
	'accounts',
	'assets',
	'trustlines',
	'offers',
	'liquidity-pools',
	'contracts',
	'contract-data-values',
	'contract-code-values',
	'operation-type-details',
	'transaction-meta-values',
	'ttl-entries',
	'config-settings',
	'restored-keys'
] as const;

const unsupportedV6 = [
	...unsupportedV7.slice(0, 12),
	'contract-event-topics-and-data',
	'ledger-entry-keys-and-values',
	...unsupportedV7.slice(12)
] as const;

const unsupportedV8 = [
	'ledger-close-upgrades-and-extension-values',
	'transaction-envelope-details',
	'operation-result-details',
	'effects',
	'account-current-state-and-signers',
	'assets',
	'trustline-current-state',
	'offers',
	'liquidity-pools',
	'contracts',
	'contract-data-values',
	'contract-code-values',
	'operation-type-details',
	'transaction-meta-values',
	'ttl-entries',
	'config-settings',
	'restored-keys'
] as const;

export function goFullHistoryLedgerCloseMetaManifestVersion(
	value: unknown
): GoFullHistoryLedgerCloseMetaManifestVersion {
	if (
		value === manifestVersionV6 ||
		value === manifestVersionV7 ||
		value === manifestVersionV8
	) {
		return value;
	}
	throw new TypeError('manifestVersion is not compatible with this service');
}

export function expectedUnsupportedLedgerCloseMetaDatasets(
	version: GoFullHistoryLedgerCloseMetaManifestVersion
): readonly string[] {
	if (version === manifestVersionV6) return unsupportedV6;
	if (version === manifestVersionV7) return unsupportedV7;
	return unsupportedV8;
}

export function assertLedgerCloseMetaManifestProjection(
	version: GoFullHistoryLedgerCloseMetaManifestVersion,
	outputs: readonly FullHistoryLedgerCloseMetaDatasetOutput[]
): void {
	const expectedDatasets =
		version === manifestVersionV8
			? FULL_HISTORY_LEDGER_CLOSE_META_DATASETS
			: FULL_HISTORY_LEDGER_CLOSE_META_CORE_DATASETS;
	const actualDatasets = new Set(outputs.map((output) => output.dataset));
	if (
		outputs.length !== expectedDatasets.length ||
		expectedDatasets.some((dataset) => !actualDatasets.has(dataset))
	) {
		throw new TypeError(`${version} output set is incomplete`);
	}

	const schemaVersions = expectedSchemaVersions(version);
	for (const [dataset, schemaVersion] of Object.entries(schemaVersions)) {
		if (
			outputs.find((output) => output.dataset === dataset)?.schemaVersion !==
			schemaVersion
		) {
			throw new TypeError(
				`${dataset} schema is not compatible with ${version}`
			);
		}
	}
}

function expectedSchemaVersions(
	version: GoFullHistoryLedgerCloseMetaManifestVersion
): Readonly<Record<string, string>> {
	const projectionSchemas = {
		'contract-events':
			version === manifestVersionV6
				? 'stellar-atlas.full-history.contract-events.v2'
				: FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS['contract-events'],
		'ledger-entry-changes':
			version === manifestVersionV6
				? 'stellar-atlas.full-history.ledger-entry-changes.v2'
				: FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS['ledger-entry-changes']
	};
	if (version !== manifestVersionV8) return projectionSchemas;
	return {
		...projectionSchemas,
		'account-state-changes':
			FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS['account-state-changes'],
		'trustline-state-changes':
			FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS['trustline-state-changes']
	};
}

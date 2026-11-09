import type { EntityManager } from 'typeorm';
import type { ContractBuildRecord } from './ContractBuildAttestation.js';
import type { ContractProvenance } from './ContractProvenanceService.js';
import {
	catalogueCursor,
	catalogueNetworkKey,
	projectCatalogueItem,
	type ContractCatalogueItem,
	type ContractCataloguePage,
	type ContractCatalogueQuery
} from './ContractCatalogue.js';

interface CatalogueRow {
	readonly contract_id: string;
	readonly observed_ledger: string;
	readonly instance_modified_ledger: string | null;
	readonly checked_at: Date;
	readonly wasm_sha256: string;
	readonly build_record: ContractBuildRecord;
}

export class ContractCatalogueStore {
	private readonly networkKey: string;

	constructor(
		private readonly manager: EntityManager,
		private readonly networkPassphrase: string
	) {
		this.networkKey = catalogueNetworkKey(networkPassphrase);
	}

	async observe(value: ContractProvenance): Promise<void> {
		if (value.networkPassphrase !== this.networkPassphrase) return;
		const item = projectCatalogueItem(value);
		if (!item) return;
		await this.manager.transaction(async (manager) => {
			await manager.query("SET LOCAL statement_timeout = '1s'");
			await manager.query("SET LOCAL lock_timeout = '250ms'");
			await manager.query(
				`INSERT INTO contract_verification_catalogue AS existing
					(network_key, contract_id, repository_key, observed_ledger,
					 instance_modified_ledger, checked_at, wasm_sha256, build_record)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
				ON CONFLICT (network_key, contract_id) DO UPDATE SET
					repository_key = EXCLUDED.repository_key,
					observed_ledger = EXCLUDED.observed_ledger,
					instance_modified_ledger = EXCLUDED.instance_modified_ledger,
					checked_at = EXCLUDED.checked_at,
					wasm_sha256 = EXCLUDED.wasm_sha256,
					build_record = EXCLUDED.build_record
				WHERE EXCLUDED.observed_ledger > existing.observed_ledger
				   OR (EXCLUDED.observed_ledger = existing.observed_ledger
				       AND EXCLUDED.wasm_sha256 = existing.wasm_sha256
				       AND EXCLUDED.checked_at > existing.checked_at)`,
				[
					this.networkKey,
					item.contractId,
					item.build.record.repository.toLowerCase(),
					item.observedLedger,
					item.instanceModifiedLedger,
					item.checkedAt,
					item.wasmSha256,
					JSON.stringify(item.build.record)
				]
			);
		});
	}

	async list(query: ContractCatalogueQuery): Promise<ContractCataloguePage> {
		const { filter, after, limit } = query;
		const values: (string | number)[] = [this.networkKey];
		const bind = (value: string | number): string => {
			values.push(value);
			return '$' + values.length;
		};
		const conditions = ['network_key = $1'];
		let order = 'contract_id';
		if (filter.kind === 'contract') {
			conditions.push('contract_id = ' + bind(filter.contractId));
		} else if (filter.kind === 'repository') {
			// Repository keys are ASCII and indexed with C collation.
			conditions.push('repository_key >= ' + bind(filter.prefix));
			conditions.push('repository_key < ' + bind(filter.prefix + '\x7f'));
			if (after?.repositoryKey)
				conditions.push(
					'(repository_key, contract_id) > (' +
						bind(after.repositoryKey) +
						', ' +
						bind(after.contractId) +
						')'
				);
			order = 'repository_key, contract_id';
		} else if (after) {
			conditions.push('contract_id > ' + bind(after.contractId));
		}
		const take = bind(limit + 1);
		const rows = await this.manager.transaction(async (manager) => {
			await manager.query('SET TRANSACTION READ ONLY');
			await manager.query("SET LOCAL statement_timeout = '1s'");
			await manager.query("SET LOCAL lock_timeout = '250ms'");
			return manager.query<CatalogueRow[]>(
				`SELECT contract_id, observed_ledger, instance_modified_ledger, checked_at,
					wasm_sha256, build_record
				FROM contract_verification_catalogue
				WHERE ${conditions.join(' AND ')}
				ORDER BY ${order} LIMIT ${take}`,
				values
			);
		});
		const items = rows.slice(0, limit).map(mapRow);
		return {
			version: 1,
			networkPassphrase: this.networkPassphrase,
			items,
			nextCursor:
				rows.length > limit
					? catalogueCursor(query, items[items.length - 1]!)
					: null
		};
	}
}

function mapRow(row: CatalogueRow): ContractCatalogueItem {
	return {
		contractId: row.contract_id,
		observedLedger: Number(row.observed_ledger),
		instanceModifiedLedger:
			row.instance_modified_ledger === null
				? null
				: Number(row.instance_modified_ledger),
		checkedAt: row.checked_at.toISOString(),
		wasmSha256: row.wasm_sha256,
		ledgerEvidence: 'configured_rpc_observation',
		build: { status: 'verified', record: row.build_record },
		independentReproduction: 'not_assessed',
		securityAudit: 'not_assessed'
	};
}

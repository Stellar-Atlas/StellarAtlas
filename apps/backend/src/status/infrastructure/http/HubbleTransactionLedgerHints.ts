import { normalizeTransactionInput } from './HubbleTransactionCursor.js';
import type { HubbleTransactionLedgerLocator } from './HubbleTransactionLedgerLocator.js';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';

/** An optional accelerator shared by REST and GraphQL; never a data-availability gate. */
export function withHubbleTransactionLedgerHints(
	warehouse: HubbleWarehouse,
	locateLedger: HubbleTransactionLedgerLocator
): HubbleWarehouse {
	return {
		catalog: (force) => warehouse.catalog(force),
		query: (input) => warehouse.query(input),
		contractEvents: (input) => warehouse.contractEvents(input),
		transferActivity: (input) => warehouse.transferActivity(input),
		classifyEventRows: (rows) => warehouse.classifyEventRows(rows),
		accountTransactions: (input) => warehouse.accountTransactions(input),
		assetHolders: (input) => warehouse.assetHolders(input),
		async transactionDetail(request) {
			const input = normalizeTransactionInput(request);
			if (input.ledgerSequence === undefined) {
				let hint: number | null = null;
				try {
					hint = await locateLedger(input.transactionHash);
				} catch {
					// Missing, unavailable or timed-out canonical metadata does not
					// exclude transactions present only in the parsed warehouse.
				}
				if (
					hint !== null &&
					Number.isSafeInteger(hint) &&
					hint >= 1 &&
					hint <= 2147483647
				) {
					const detail = await warehouse.transactionDetail({
						...input,
						ledgerSequence: hint
					});
					if (detail !== null) {
						if (
							detail.transaction.hash !== input.transactionHash ||
							detail.transaction.ledgerSequence !== hint
						)
							throw new HubbleWarehouseUnavailableError(
								'Located parsed transaction identity does not match the requested hash and ledger'
							);
						return detail;
					}
				}
			}
			return warehouse.transactionDetail(input);
		}
	};
}

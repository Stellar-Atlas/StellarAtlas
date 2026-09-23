import type { HubbleAccountBalancePage } from './HubbleAccountBalanceContracts.js';
import {
	decodeBalanceCursor,
	requireBalanceAccount
} from './HubbleAccountBalanceCursor.js';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';

export const hubbleAccountBalanceSchema = `
	extend type Query {
		"""Latest ingested native and issued balance observations, not current-chain or as-of state. Missing observations do not prove account absence."""
		hubbleAccountBalances(account: String!, input: HubbleAccountBalanceInput): HubbleAccountBalancePage!
	}
	input HubbleAccountBalanceInput { after: String limit: Int }
	type HubbleAccountBalance {
		asset: String! assetType: String! assetCode: String assetIssuer: String
		balance: Float!
		"""Always null: the source Float64 balance cannot establish exact atomic units."""
		balanceRaw: String
		amountPrecision: String! buyingLiabilities: Float! sellingLiabilities: Float!
		trustLineLimitRaw: String flags: String! lastModifiedLedger: Int! observedLedger: Int!
	}
	type HubbleAccountBalancePage {
		account: String! balanceScope: String! balances: [HubbleAccountBalance!]!
		limit: Int! nextCursor: String elapsedMilliseconds: Float!
		coverage: HubbleLedgerCoverage! watermark: HubbleAssetHolderWatermark!
	}
`;

interface Arguments {
	readonly account: string;
	readonly input?: {
		readonly after?: string | null;
		readonly limit?: number | null;
	} | null;
}

export function hubbleAccountBalanceResolvers(
	warehouse: HubbleWarehouse,
	mapError: (error: unknown) => Error
): Record<string, (args: Arguments) => Promise<HubbleAccountBalancePage>> {
	return {
		hubbleAccountBalances: async ({ account, input }) => {
			try {
				const limit = input?.limit ?? 100;
				if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
					throw new HubbleWarehouseInputError(
						'limit must be an integer between 1 and 200'
					);
				const validatedAccount = requireBalanceAccount(account);
				const after = input?.after ?? undefined;
				decodeBalanceCursor(validatedAccount, after);
				return await warehouse.accountBalances({
					account: validatedAccount,
					after,
					limit
				});
			} catch (error) {
				throw mapError(error);
			}
		}
	};
}

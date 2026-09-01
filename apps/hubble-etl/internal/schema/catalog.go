package schema

import (
	"reflect"

	"github.com/stellar/stellar-etl/v2/internal/transform"
)

// Dataset binds a public Hubble table name to the official stellar-etl row.
type Dataset struct {
	Name    string
	RowType reflect.Type
	OrderBy []string
}

var catalog = []Dataset{
	dataset("history_ledgers", transform.LedgerOutput{}, "sequence"),
	dataset("history_transactions", transform.TransactionOutput{}, "ledger_sequence", "id"),
	dataset("ledger_transactions", transform.LedgerTransactionOutput{}, "ledger_sequence"),
	dataset("history_operations", transform.OperationOutput{}, "ledger_sequence", "id"),
	dataset("history_effects", transform.EffectOutput{}, "ledger_sequence", "id"),
	dataset("history_assets", transform.AssetOutput{}, "asset_code", "asset_issuer", "ledger_sequence"),
	dataset("history_trades", transform.TradeOutput{}, "_ledger_sequence", "history_operation_id", "order"),
	dataset("history_contract_events", transform.ContractEventOutput{}, "ledger_sequence", "transaction_id"),
	dataset("token_transfers", transform.TokenTransferOutput{}, "ledger_sequence", "transaction_id"),
	dataset("accounts", transform.AccountOutput{}, "account_id", "ledger_sequence"),
	dataset("account_signers", transform.AccountSignerOutput{}, "account_id", "signer", "ledger_sequence"),
	dataset("claimable_balances", transform.ClaimableBalanceOutput{}, "balance_id", "ledger_sequence"),
	dataset("liquidity_pools", transform.PoolOutput{}, "liquidity_pool_id", "ledger_sequence"),
	dataset("trustlines", transform.TrustlineOutput{}, "account_id", "asset_code", "asset_issuer", "ledger_sequence"),
	dataset("offers", transform.OfferOutput{}, "seller_id", "offer_id", "ledger_sequence"),
	dataset("contract_data", transform.ContractDataOutput{}, "contract_id", "ledger_sequence"),
	dataset("contract_code", transform.ContractCodeOutput{}, "contract_code_hash", "ledger_sequence"),
	dataset("config_settings", transform.ConfigSettingOutput{}, "config_setting_id", "ledger_sequence"),
	dataset("ttl", transform.TtlOutput{}, "key_hash", "ledger_sequence"),
	dataset("restored_key", transform.RestoredKeyOutput{}, "ledger_key_hash", "ledger_sequence"),
}

func dataset(name string, row any, keys ...string) Dataset {
	return Dataset{Name: name, RowType: reflect.TypeOf(row), OrderBy: keys}
}

// Datasets returns a defensive copy of the public schema catalog.
func Datasets() []Dataset {
	result := make([]Dataset, len(catalog))
	for i, item := range catalog {
		result[i] = item
		result[i].OrderBy = append([]string(nil), item.OrderBy...)
	}
	return result
}

// Lookup finds a public Hubble dataset.
func Lookup(name string) (Dataset, bool) {
	for _, item := range catalog {
		if item.Name == name {
			item.OrderBy = append([]string(nil), item.OrderBy...)
			return item, true
		}
	}
	return Dataset{}, false
}

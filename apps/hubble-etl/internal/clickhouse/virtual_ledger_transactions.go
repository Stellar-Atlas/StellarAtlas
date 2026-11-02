package clickhouse

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
)

// The storage migration owns the dictionary/view SQL. Startup must
// neither create a physical replacement nor accept a similarly named table.
func (c *Client) checkVirtualLedgerTransactions(ctx context.Context) error {
	query := "SELECT engine, comment FROM system.tables" +
		" WHERE database={database:String} AND name='ledger_transactions' FORMAT JSON"
	body, err := c.execute(ctx, query, url.Values{"param_database": {c.database}}, nil)
	if err != nil {
		return fmt.Errorf("verify virtual ledger_transactions: %w", err)
	}
	var response struct {
		Data []struct {
			Engine  string `json:"engine"`
			Comment string `json:"comment"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return fmt.Errorf("decode virtual ledger_transactions metadata: %w", err)
	}
	if len(response.Data) != 1 || response.Data[0].Engine != "View" || response.Data[0].Comment != "stellaratlas-ledger-transactions-v1" {
		return fmt.Errorf("virtual ledger_transactions migration required: expected View with comment stellaratlas-ledger-transactions-v1")
	}
	return nil
}

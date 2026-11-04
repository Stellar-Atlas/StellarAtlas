package clickhouse

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// Only recognize installed, complete layouts. In particular, an absent view
// during an interrupted migration must not cause physical-table recreation.
// Explicit true flags are never downgraded; Initialize still asserts them.
func (c *Client) detectStorageLayout(ctx context.Context) error {
	params := url.Values{"param_database": {c.database}}
	ledgerBody, err := c.execute(ctx,
		"SELECT engine, comment FROM system.tables"+
			" WHERE database={database:String} AND name='ledger_transactions' FORMAT JSON",
		params, nil)
	if err != nil {
		return fmt.Errorf("detect ledger storage layout: %w", err)
	}
	var ledger struct {
		Data []struct {
			Engine  string `json:"engine"`
			Comment string `json:"comment"`
		} `json:"data"`
	}
	if err := json.Unmarshal(ledgerBody, &ledger); err != nil {
		return fmt.Errorf("decode ledger storage layout: %w", err)
	}
	if len(ledger.Data) != 1 {
		return fmt.Errorf("storage layout auto detection requires exactly one installed ledger_transactions object")
	}
	virtual := c.virtualLedgerTransactions
	switch row := ledger.Data[0]; row.Engine {
	case "ReplacingMergeTree":
		// Keep the explicit/default setting; a true flag must fail its assertion.
	case "View":
		if row.Comment != "stellaratlas-ledger-transactions-v1" {
			return fmt.Errorf("unrecognized ledger_transactions View comment during storage layout detection")
		}
		virtual = true
	default:
		return fmt.Errorf("unrecognized ledger_transactions engine %q during storage layout detection", row.Engine)
	}
	operationsBody, err := c.execute(ctx,
		"SELECT name, type, default_kind, default_expression FROM system.columns"+
			" WHERE database={database:String} AND table='history_operations'"+
			" AND name IN ('details', 'details_json') FORMAT JSON",
		params, nil)
	if err != nil {
		return fmt.Errorf("detect operations storage layout: %w", err)
	}
	type operationColumn struct {
		Name       string `json:"name"`
		Type       string `json:"type"`
		Kind       string `json:"default_kind"`
		Expression string `json:"default_expression"`
	}
	var operations struct {
		Data []operationColumn `json:"data"`
	}
	if err := json.Unmarshal(operationsBody, &operations); err != nil {
		return fmt.Errorf("decode operations storage layout: %w", err)
	}
	columns := make(map[string]operationColumn, 2)
	for _, column := range operations.Data {
		if _, duplicate := columns[column.Name]; duplicate || column.Type != "Dynamic" {
			return fmt.Errorf("unrecognized history_operations duplicate or non-Dynamic column during storage layout detection")
		}
		columns[column.Name] = column
	}
	details, hasDetails := columns["details"]
	physical, hasPhysical := columns["details_json"]
	if len(operations.Data) != 2 || !hasDetails || !hasPhysical || physical.Kind != "" || strings.TrimSpace(physical.Expression) != "" {
		return fmt.Errorf("storage layout auto detection requires physical Dynamic details_json and a recognized details column")
	}
	singleCopy := c.singleCopyOperations
	switch details.Kind {
	case "":
		if strings.TrimSpace(details.Expression) != "" {
			return fmt.Errorf("unrecognized physical history_operations.details expression during storage layout detection")
		}
	case "ALIAS":
		expression := strings.TrimSpace(details.Expression)
		if expression != "details_json" && expression != "`details_json`" {
			return fmt.Errorf("unrecognized history_operations.details alias during storage layout detection")
		}
		singleCopy = true
	default:
		return fmt.Errorf("unrecognized history_operations.details default kind during storage layout detection")
	}
	// Commit mode discovery together only after both installed layouts validate.
	c.virtualLedgerTransactions = virtual
	c.singleCopyOperations = singleCopy
	return nil
}

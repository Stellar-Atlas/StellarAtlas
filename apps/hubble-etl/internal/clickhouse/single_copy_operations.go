package clickhouse

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

// Shadow only the duplicate JSON member; do not round-trip official numeric
// fields through interface{} or change the upstream operation's other fields.
type singleCopyOperation struct {
	transform.OperationOutput
	Details json.RawMessage `json:"details,omitempty"`
}

func singleCopyOperationRow(row any) (any, error) {
	switch operation := row.(type) {
	case transform.OperationOutput:
		return singleCopyOperation{OperationOutput: operation}, nil
	case *transform.OperationOutput:
		if operation != nil {
			return singleCopyOperation{OperationOutput: *operation}, nil
		}
	}
	return nil, fmt.Errorf("single-copy history_operations requires a non-nil official OperationOutput, got %T", row)
}

func operationInsertColumns(columns []schema.Column) []schema.Column {
	physical := make([]schema.Column, 0, len(columns))
	for _, column := range columns {
		if column.Name != "details" {
			physical = append(physical, column)
		}
	}
	return physical
}

func (c *Client) tableSQL(dataset schema.Dataset) (string, error) {
	statement, err := schema.TableSQL(c.database, dataset)
	if err != nil || !c.singleCopyOperations || dataset.Name != "history_operations" {
		return statement, err
	}
	definition := "\t`details` Dynamic"
	if strings.Count(statement, definition+",") != 1 {
		return "", fmt.Errorf("single-copy operations schema changed: expected one Dynamic details column")
	}
	return strings.Replace(statement, definition+",", definition+" ALIAS `details_json`,", 1), nil
}

// Metadata only: existing tables must have been migrated separately. This code
// never drops, alters or materializes an existing operation column.
func (c *Client) checkSingleCopyOperations(ctx context.Context) error {
	query := "SELECT name, type, default_kind, default_expression FROM system.columns" +
		" WHERE database={database:String} AND table='history_operations'" +
		" AND name IN ('details', 'details_json') FORMAT JSON"
	body, err := c.execute(ctx, query, url.Values{"param_database": {c.database}}, nil)
	if err != nil {
		return fmt.Errorf("verify single-copy operations schema: %w", err)
	}
	var response struct {
		Data []struct {
			Name       string `json:"name"`
			Type       string `json:"type"`
			Kind       string `json:"default_kind"`
			Expression string `json:"default_expression"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return fmt.Errorf("decode single-copy operations schema: %w", err)
	}
	alias, physical := false, false
	for _, column := range response.Data {
		switch column.Name {
		case "details":
			if alias || column.Type != "Dynamic" || column.Kind != "ALIAS" ||
				strings.TrimSpace(column.Expression) != "details_json" && strings.TrimSpace(column.Expression) != "`details_json`" {
				return fmt.Errorf("single-copy operations migration required: details must be Dynamic ALIAS details_json")
			}
			alias = true
		case "details_json":
			if physical || column.Type != "Dynamic" || column.Kind != "" {
				return fmt.Errorf("single-copy operations migration required: details_json must be a physical Dynamic column")
			}
			physical = true
		}
	}
	if len(response.Data) != 2 || !alias || !physical {
		return fmt.Errorf("single-copy operations migration required: expected physical details_json and details alias")
	}
	return nil
}

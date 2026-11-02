package clickhouse

import (
	"fmt"
	"reflect"
	"sync"

	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

// Exact pinned official row/schema only. The omitted details member is already
// an alias of physical details_json under single-copy operations, not lost data.
var typedOperationsColumns = []schema.Column{
	{"source_account", "String"}, {"source_account_muxed", "String"}, {"type", "Int32"}, {"type_string", "String"},
	{"transaction_id", "Int64"}, {"id", "Int64"}, {"closed_at", "DateTime64(6, 'UTC')"},
	{"operation_result_code", "String"}, {"operation_trace_code", "String"}, {"ledger_sequence", "UInt32"}, {"details_json", "Dynamic"},
	{"_batch_id", "UUID"}, {"_source_sha256", "FixedString(64)"}, {"_ledger_sequence", "UInt32"}, {"_row_number", "UInt64"}, {"_ingested_at", "DateTime64(6, 'UTC')"},
}

var typedOperationsCached struct {
	sync.Once
	plan typedEffectsPlan
	err  error
}

func typedOperationsField(t reflect.Type, kind string) (func(reflect.Value) (any, error), error) {
	if t == reflect.TypeOf(map[string]any{}) && kind == "Dynamic" {
		return func(v reflect.Value) (any, error) {
			if v.IsNil() {
				return nil, nil
			}
			// JSON is already retained. A custom marshaler must not run again:
			// decline the whole typed row so the exact retained bytes are decoded.
			next, err := directTypedDynamic(v.Interface(), 0)
			if err != nil {
				return nil, errTypedNativeUnsupported
			}
			return next, nil
		}, nil
	}
	return typedEffectsField(t, kind)
}

func typedOperationsSchema() (typedEffectsPlan, error) {
	typedOperationsCached.Do(func() {
		ds, ok := schema.Lookup("history_operations")
		if !ok || ds.RowType != reflect.TypeOf(transform.OperationOutput{}) || ds.RowType.NumField() != 12 {
			typedOperationsCached.err = fmt.Errorf("unsupported exact operations row type")
			return
		}
		columns, err := schema.Columns(ds)
		if err != nil {
			typedOperationsCached.err = err
			return
		}
		columns = operationInsertColumns(columns)
		if !reflect.DeepEqual(columns, typedOperationsColumns) {
			typedOperationsCached.err = fmt.Errorf("unsupported single-copy operations schema fingerprint")
			return
		}
		names := []string{"SourceAccount", "SourceAccountMuxed", "Type", "TypeString", "OperationDetails", "TransactionID", "OperationID", "ClosedAt", "OperationResultCode", "OperationTraceCode", "LedgerSequence", "OperationDetailsJSON"}
		plan := typedEffectsPlan{columns: columns}
		for i, name := range names {
			field := ds.RowType.Field(i)
			if field.Name != name || field.Anonymous || field.PkgPath != "" {
				typedOperationsCached.err = fmt.Errorf("unsupported exact operation field %s", name)
				return
			}
			if i == 4 {
				if field.Type != reflect.TypeOf(map[string]any{}) || string(field.Tag) != `json:"details"` {
					typedOperationsCached.err = fmt.Errorf("unsupported operation details alias")
					return
				}
				continue
			}
			column := columns[len(plan.fields)]
			tag := `json:"` + column.Name + `"`
			if i == 1 {
				tag = `json:"source_account_muxed,omitempty"`
			}
			if string(field.Tag) != tag {
				typedOperationsCached.err = fmt.Errorf("unsupported exact operation field tag %s", name)
				return
			}
			value, err := typedOperationsField(field.Type, column.Type)
			if err != nil {
				typedOperationsCached.err = err
				return
			}
			plan.fields = append(plan.fields, typedNativeBinding{i, value})
		}
		typedOperationsCached.plan = plan
	})
	return typedOperationsCached.plan, typedOperationsCached.err
}

package clickhouse

import (
	"fmt"
	"reflect"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/guregu/null"
	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

var typedEventsColumns = []schema.Column{
	{"transaction_hash", "String"}, {"transaction_id", "Int64"}, {"successful", "Bool"}, {"ledger_sequence", "UInt32"}, {"closed_at", "DateTime64(6, 'UTC')"},
	{"in_successful_contract_call", "Bool"}, {"contract_id", "String"}, {"type", "Int32"}, {"type_string", "String"}, {"topics", "Dynamic"}, {"topics_decoded", "Dynamic"},
	{"data", "Dynamic"}, {"data_decoded", "Dynamic"}, {"contract_event_xdr", "String"}, {"operation_id", "Nullable(Int64)"},
	{"_batch_id", "UUID"}, {"_source_sha256", "FixedString(64)"}, {"_ledger_sequence", "UInt32"}, {"_row_number", "UInt64"}, {"_ingested_at", "DateTime64(6, 'UTC')"},
}

type typedEventsPlan struct {
	columns []schema.Column
	fields  []typedNativeBinding
}

var typedEventsCached struct {
	sync.Once
	plan typedEventsPlan
	err  error
}

func typedEventsField(t reflect.Type, kind string) (func(reflect.Value) (any, error), error) {
	if t == reflect.TypeOf(time.Time{}) && kind == "DateTime64(6, 'UTC')" {
		return func(v reflect.Value) (any, error) { t := v.Interface().(time.Time); return t, typedNativeTime(t) }, nil
	}
	if t == reflect.TypeOf(null.Int{}) && kind == "Nullable(Int64)" {
		return func(v reflect.Value) (any, error) {
			n := v.Interface().(null.Int)
			if !n.Valid {
				return nil, nil
			}
			return n.Int64, nil
		}, nil
	}
	// These four exact official field types retain the current JSON normalization.
	if kind == "Dynamic" && (t == reflect.TypeOf([]interface{}{}) || t == reflect.TypeOf((*interface{})(nil)).Elem()) {
		return func(v reflect.Value) (any, error) {
			return prepareTypedDynamic(v.Interface())
		}, nil
	}
	exact := map[reflect.Kind]string{reflect.String: "String", reflect.Bool: "Bool", reflect.Int64: "Int64", reflect.Int32: "Int32", reflect.Uint32: "UInt32"}
	if want, ok := exact[t.Kind()]; ok && kind == want && t.PkgPath() == "" {
		return func(v reflect.Value) (any, error) {
			if v.Kind() == reflect.String && !utf8.ValidString(v.String()) {
				return nil, fmt.Errorf("%w: invalid UTF-8 scalar", errTypedNativeUnsupported)
			}
			return v.Interface(), nil
		}, nil
	}
	return nil, fmt.Errorf("unsupported contract-event binding %s -> %s", t, kind)
}

func typedEventsSchema() (typedEventsPlan, error) {
	typedEventsCached.Do(func() {
		ds, ok := schema.Lookup("history_contract_events")
		if !ok || ds.RowType != reflect.TypeOf(transform.ContractEventOutput{}) {
			typedEventsCached.err = fmt.Errorf("unsupported official event row type")
			return
		}
		cols, err := schema.Columns(ds)
		if err != nil {
			typedEventsCached.err = err
			return
		}
		if !reflect.DeepEqual(cols, typedEventsColumns) || ds.RowType.NumField() != 15 {
			typedEventsCached.err = fmt.Errorf("unsupported event schema fingerprint")
			return
		}
		names := []string{"TransactionHash", "TransactionID", "Successful", "LedgerSequence", "ClosedAt", "InSuccessfulContractCall", "ContractId", "Type", "TypeString", "Topics", "TopicsDecoded", "Data", "DataDecoded", "ContractEventXDR", "OperationID"}
		plan := typedEventsPlan{columns: cols}
		for i, name := range names {
			field := ds.RowType.Field(i)
			if field.Name != name || field.Anonymous || field.PkgPath != "" || string(field.Tag) != `json:"`+cols[i].Name+`"` {
				typedEventsCached.err = fmt.Errorf("unsupported exact event field/tag %s", name)
				return
			}
			if (i == 9 || i == 10) && field.Type != reflect.TypeOf([]interface{}{}) || (i == 11 || i == 12) && field.Type != reflect.TypeOf((*interface{})(nil)).Elem() {
				typedEventsCached.err = fmt.Errorf("unsupported exact Dynamic field type %s", name)
				return
			}
			value, err := typedEventsField(field.Type, cols[i].Type)
			if err != nil {
				typedEventsCached.err = err
				return
			}
			plan.fields = append(plan.fields, typedNativeBinding{i, value})
		}
		typedEventsCached.plan = plan
	})
	return typedEventsCached.plan, typedEventsCached.err
}

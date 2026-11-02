package clickhouse

import (
	"fmt"
	"reflect"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/guregu/null"
	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

type typedEffectsPlan struct {
	columns []schema.Column
	fields  []typedNativeBinding
}

var typedEffectsCached struct {
	sync.Once
	plan typedEffectsPlan
	err  error
}

func typedEffectsField(t reflect.Type, kind string) (func(reflect.Value) (any, error), error) {
	if t == reflect.TypeOf(time.Time{}) && kind == "DateTime64(6, 'UTC')" {
		return func(v reflect.Value) (any, error) { t := v.Interface().(time.Time); return t, typedNativeTime(t) }, nil
	}
	if t == reflect.TypeOf(null.String{}) && kind == "Nullable(String)" {
		return func(v reflect.Value) (any, error) {
			n := v.Interface().(null.String)
			if !n.Valid {
				return nil, nil
			}
			if !utf8.ValidString(n.String) {
				return nil, fmt.Errorf("%w: invalid UTF-8 nullable scalar", errTypedNativeUnsupported)
			}
			return n.String, nil
		}, nil
	}
	if t == reflect.TypeOf(map[string]interface{}{}) && kind == "Dynamic" {
		// Only the Dynamic field retains JSON normalization. This preserves the
		// current integer-width, decimal-string, null, nested-map/array rules and
		// JSON's rejection of nonfinite floats/custom MarshalJSON errors.
		return func(v reflect.Value) (any, error) {
			return prepareRetainedTypedDynamic(v.Interface())
		}, nil
	}
	exact := map[reflect.Kind]string{reflect.String: "String", reflect.Int64: "Int64", reflect.Int32: "Int32", reflect.Uint32: "UInt32"}
	if want, ok := exact[t.Kind()]; ok && kind == want && t.PkgPath() == "" {
		return func(v reflect.Value) (any, error) {
			if v.Kind() == reflect.String && !utf8.ValidString(v.String()) {
				return nil, fmt.Errorf("%w: invalid UTF-8 scalar", errTypedNativeUnsupported)
			}
			return v.Interface(), nil
		}, nil
	}
	return nil, fmt.Errorf("unsupported effects field binding %s -> %s", t, kind)
}
func typedEffectsSchema() (typedEffectsPlan, error) {
	typedEffectsCached.Do(func() {
		dataset, ok := schema.Lookup("history_effects")
		if !ok || dataset.RowType != reflect.TypeOf(transform.EffectOutput{}) {
			typedEffectsCached.err = fmt.Errorf("unsupported effects row type")
			return
		}
		plan := typedEffectsPlan{}
		plan.columns, typedEffectsCached.err = schema.Columns(dataset)
		if typedEffectsCached.err != nil {
			return
		}
		if !reflect.DeepEqual(plan.columns, typedEffectsColumns) {
			typedEffectsCached.err = fmt.Errorf("unsupported effects schema fingerprint")
			return
		}
		fields := map[string]int{}
		for i := 0; i < dataset.RowType.NumField(); i++ {
			field := dataset.RowType.Field(i)
			parts := strings.Split(field.Tag.Get("json"), ",")
			name := parts[0]
			if name == "-" {
				continue
			}
			if name == "" {
				name = field.Name
			}
			if len(parts) > 2 || len(parts) == 2 && parts[1] != "omitempty" {
				typedEffectsCached.err = fmt.Errorf("unsupported JSON tag %s", field.Tag)
				return
			}
			if _, exists := fields[name]; exists {
				typedEffectsCached.err = fmt.Errorf("duplicate field %s", name)
				return
			}
			fields[name] = i
		}
		dynamics := 0
		for _, c := range plan.columns {
			if strings.HasPrefix(c.Name, "_") {
				continue
			}
			i, ok := fields[c.Name]
			if !ok {
				typedEffectsCached.err = fmt.Errorf("unbound column %s", c.Name)
				return
			}
			if c.Type == "Dynamic" {
				dynamics++
				if c.Name != "details" {
					typedEffectsCached.err = fmt.Errorf("unsupported extra Dynamic column %s", c.Name)
					return
				}
			}
			value, err := typedEffectsField(dataset.RowType.Field(i).Type, c.Type)
			if err != nil {
				typedEffectsCached.err = err
				return
			}
			plan.fields = append(plan.fields, typedNativeBinding{i, value})
			delete(fields, c.Name)
		}
		meta := []schema.Column{{"_batch_id", "UUID"}, {"_source_sha256", "FixedString(64)"}, {"_ledger_sequence", "UInt32"}, {"_row_number", "UInt64"}, {"_ingested_at", "DateTime64(6, 'UTC')"}}
		if len(fields) != 0 || dynamics != 1 || len(plan.columns) != len(plan.fields)+5 || !reflect.DeepEqual(plan.columns[len(plan.fields):], meta) {
			typedEffectsCached.err = fmt.Errorf("unsupported effects/metadata schema drift")
			return
		}
		typedEffectsCached.plan = plan
	})
	return typedEffectsCached.plan, typedEffectsCached.err
}

var typedEffectsColumns = []schema.Column{
	{"address", "String"}, {"address_muxed", "Nullable(String)"}, {"operation_id", "Int64"}, {"details", "Dynamic"}, {"type", "Int32"}, {"type_string", "String"}, {"closed_at", "DateTime64(6, 'UTC')"}, {"ledger_sequence", "UInt32"}, {"index", "UInt32"}, {"id", "String"},
	{"_batch_id", "UUID"}, {"_source_sha256", "FixedString(64)"}, {"_ledger_sequence", "UInt32"}, {"_row_number", "UInt64"}, {"_ingested_at", "DateTime64(6, 'UTC')"},
}

package clickhouse

import (
	"context"
	"errors"
	"fmt"
	"github.com/ClickHouse/clickhouse-go/v2/lib/chcol"
	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
	"reflect"
	"time"
)

type typedNativeBinding struct {
	index int
	value func(reflect.Value) (any, error)
}

var errTypedNativeUnsupported = errors.New("unsupported typed Native scalar")

func typedNativeTime(t time.Time) error {
	_, offset := t.Zone()
	if t.Year() < 0 || t.Year() > 9999 || offset <= -24*3600 || offset >= 24*3600 || offset%60 != 0 {
		return fmt.Errorf("%w: JSON timestamp %v", errTypedNativeUnsupported, t)
	}
	return nil
}
func typedNativeEnabled(limits WriterLimits, dataset string) bool {
	return dataset == "history_effects" && limits.TypedEffects || dataset == "history_contract_events" && limits.TypedEvents || dataset == "history_operations" && limits.TypedOperations
}
func typedNativeSchema(dataset string) ([]schema.Column, []typedNativeBinding, reflect.Type, error) {
	switch dataset {
	case "history_effects":
		p, err := typedEffectsSchema()
		return p.columns, p.fields, reflect.TypeOf(transform.EffectOutput{}), err
	case "history_contract_events":
		p, err := typedEventsSchema()
		return p.columns, p.fields, reflect.TypeOf(transform.ContractEventOutput{}), err
	case "history_operations":
		p, err := typedOperationsSchema()
		return p.columns, p.fields, reflect.TypeOf(transform.OperationOutput{}), err
	default:
		return nil, nil, nil, fmt.Errorf("unsupported typed Native dataset %s", dataset)
	}
}

// PreparedNativeRow owns normalized immutable values, detached from input maps.
type PreparedNativeRow struct {
	dataset  string
	values   []any
	retained int
}
type PreparedEffectsRow = PreparedNativeRow

func (p *PreparedNativeRow) RetainedBytes() int {
	if p == nil {
		return 0
	}
	return p.retained
}
func typedNativeWeight(v any) int {
	switch x := v.(type) {
	case chcol.Dynamic:
		return 128 + typedNativeWeight(x.Any())
	case map[string]chcol.Dynamic:
		n := 256
		for k, v := range x {
			n += 512 + len(k)*2 + typedNativeWeight(v)
		}
		return n
	case []chcol.Dynamic:
		n := 256
		for _, v := range x {
			n += 128 + typedNativeWeight(v)
		}
		return n
	case string:
		return 128 + len(x)*2
	default:
		return 128
	}
}

// Safe for projection workers: only immutable flags/schema and caller row are read.
func (w *BatchWriter) PrepareNativeRow(dataset string, row any) (*PreparedNativeRow, error) {
	if !typedNativeEnabled(w.limits, dataset) {
		return nil, nil
	}
	_, fields, rowType, err := typedNativeSchema(dataset)
	if err != nil {
		return nil, err
	}
	if reflect.TypeOf(row) != rowType {
		return nil, nil
	}
	p := &PreparedNativeRow{dataset: dataset, values: make([]any, len(fields)), retained: 512}
	v := reflect.ValueOf(row)
	for i, f := range fields {
		value, err := f.value(v.Field(f.index))
		if errors.Is(err, errTypedNativeUnsupported) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		p.values[i] = value
		p.retained += typedNativeWeight(value)
	}
	return p, nil
}
func (w *BatchWriter) EmitPreparedNative(ctx context.Context, dataset string, ledger uint32, body []byte, prepared *PreparedNativeRow) error {
	return w.emitPrepared(ctx, dataset, ledger, body, prepared)
}
func (w *BatchWriter) PrepareEffectsRow(row any) (*PreparedEffectsRow, error) {
	return w.PrepareNativeRow("history_effects", row)
}
func (w *BatchWriter) EmitPreparedEffects(ctx context.Context, ledger uint32, body []byte, prepared *PreparedEffectsRow) error {
	return w.EmitPreparedNative(ctx, "history_effects", ledger, body, prepared)
}

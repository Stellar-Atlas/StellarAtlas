package clickhouse

import (
	"encoding/json"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

type encoderRoute uint8

const (
	encoderJSONEachRow encoderRoute = iota
	encoderGenericNative
	encoderTypedPrepared
	encoderTypedJSONFallback
	encoderRouteCount
)

var encoderRouteNames = [encoderRouteCount]string{"json-each-row", "generic-native", "typed-prepared", "typed-json-fallback"}

type EncoderRowBytes struct {
	Rows      uint64 `json:"rows"`
	JSONBytes uint64 `json:"jsonBytes"`
}

// MarshalJSON uses the fixed tuple [rows, jsonBytes] in bounded summaries only.
// It is not called by per-row accounting; Go fields retain their named meaning.
func (p EncoderRowBytes) MarshalJSON() ([]byte, error) {
	return json.Marshal([2]uint64{p.Rows, p.JSONBytes})
}

type encoderRouteCounts = [encoderRouteCount]EncoderRowBytes

type encoderRouteTotals struct {
	offered, attempted, failed, acknowledged EncoderRowBytes
	overflow                                 bool
}

type encoderTableStats struct {
	totals      [encoderRouteCount]encoderRouteTotals
	chunk       encoderRouteCounts
	virtualRows uint64
}

type DatasetEncoderRouteStats struct {
	Dataset      string          `json:"dataset"`
	Route        string          `json:"route"`
	Offered      EncoderRowBytes `json:"offered"`
	Attempted    EncoderRowBytes `json:"attempted"`
	Failed       EncoderRowBytes `json:"failed"`
	Acknowledged EncoderRowBytes `json:"acknowledged"`
	Overflow     bool            `json:"overflow"`
}

// OmittedDatasetRows has no serialized bytes or dataset INSERT: virtual
// ledger_transactions rows are intentionally omitted from the write path.
type OmittedDatasetRows struct {
	Dataset string `json:"dataset"`
	Rows    uint64 `json:"rows"`
}

// Immutable after initialization. Schema failures only suppress observational
// classification; they cannot introduce errors into the writer's control path.
var encoderCatalogue = func() struct {
	order  []string
	routes map[string]encoderRoute
} {
	result := struct {
		order  []string
		routes map[string]encoderRoute
	}{routes: make(map[string]encoderRoute)}
	for _, dataset := range schema.Datasets() {
		result.order = append(result.order, dataset.Name)
		columns, err := schema.Columns(dataset)
		if err != nil {
			continue
		}
		route := encoderJSONEachRow
		if hasDynamicColumns(columns) {
			route = encoderGenericNative
		}
		result.routes[dataset.Name] = route
	}
	return result
}()

func encoderAdd(target *EncoderRowBytes, other EncoderRowBytes, overflow *bool) {
	var rowsOverflow, bytesOverflow bool
	target.Rows, rowsOverflow = responseSum(target.Rows, other.Rows)
	target.JSONBytes, bytesOverflow = responseSum(target.JSONBytes, other.JSONBytes)
	*overflow = *overflow || rowsOverflow || bytesOverflow
}

// Offered means route selection after retained JSON, not decoded source rows.
// Preparation before selection is excluded and typed preparation is not timed.
// JSONBytes includes enriched JSON and its newline, not Native wire bytes.
func (w *BatchWriter) offerEncoderRoute(dataset string, table *tableBuffer, encoded []byte) encoderRoute {
	route, known := encoderCatalogue.routes[dataset]
	if typedNativeEnabled(w.limits, dataset) {
		route, known = encoderTypedJSONFallback, true
		if table != nil && table.nativePrepared != nil {
			route = encoderTypedPrepared
		}
	}
	if !known {
		return encoderRouteCount
	}
	if table != nil {
		total := &table.routeStats.totals[route]
		encoderAdd(&total.offered, EncoderRowBytes{Rows: 1, JSONBytes: uint64(len(encoded)) + 1}, &total.overflow)
	}
	return route
}

func (s *encoderTableStats) accept(route encoderRoute, bytes uint64) {
	if route >= encoderRouteCount {
		return
	}
	encoderAdd(&s.chunk[route], EncoderRowBytes{Rows: 1, JSONBytes: bytes}, &s.totals[route].overflow)
}

func (s *encoderTableStats) reject(route encoderRoute, bytes uint64) {
	if route >= encoderRouteCount {
		return
	}
	total := &s.totals[route]
	encoderAdd(&total.failed, EncoderRowBytes{Rows: 1, JSONBytes: bytes}, &total.overflow)
}

// Chunk membership is not a decoded row count. Failed membership need not have
// been attempted (e.g. cancellation), nor be unique across retries. ACK means
// dataset INSERT acknowledgment only, never batch publication or durability.
// Only the ordered writer merges job results; workers never mutate these arrays.
func (w *BatchWriter) mergeEncoderChunk(dataset string, counts encoderRouteCounts, attempted bool, err error) {
	table := w.tables[dataset]
	if table == nil {
		return
	}
	for route := encoderRoute(0); route < encoderRouteCount; route++ {
		total := &table.routeStats.totals[route]
		if attempted {
			encoderAdd(&total.attempted, counts[route], &total.overflow)
		}
		if err != nil {
			encoderAdd(&total.failed, counts[route], &total.overflow)
		} else {
			encoderAdd(&total.acknowledged, counts[route], &total.overflow)
		}
	}
}

func (w *BatchWriter) encoderRouteStats() []DatasetEncoderRouteStats {
	var result []DatasetEncoderRouteStats
	for _, dataset := range encoderCatalogue.order {
		table := w.tables[dataset]
		if table == nil {
			continue
		}
		for route := encoderRoute(0); route < encoderRouteCount; route++ {
			total := table.routeStats.totals[route]
			if total.offered.Rows == 0 {
				continue
			}
			result = append(result, DatasetEncoderRouteStats{dataset, encoderRouteNames[route], total.offered, total.attempted, total.failed, total.acknowledged, total.overflow})
		}
	}
	return result
}

func (w *BatchWriter) omittedDatasetRows() []OmittedDatasetRows {
	if table := w.tables["ledger_transactions"]; table != nil && table.routeStats.virtualRows > 0 {
		return []OmittedDatasetRows{{Dataset: "ledger_transactions", Rows: table.routeStats.virtualRows}}
	}
	return nil
}

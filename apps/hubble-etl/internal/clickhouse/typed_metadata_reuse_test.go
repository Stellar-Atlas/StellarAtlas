package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

func metadataReuseWriter(t *testing.T, dataset string, enabled bool, pending int, capture *effectsTestCapture) *BatchWriter {
	t.Helper()
	if dataset == "history_operations" {
		return operationTestWriter(t, enabled, pending, 2, capture)
	}
	return nativeTestWriter(t, enabled && dataset == "history_effects", enabled && dataset == "history_contract_events", pending, 2, 512<<20, capture)
}

func metadataReuseFixture(dataset string) any {
	switch dataset {
	case "history_effects":
		return transform.EffectOutput{Address: "G雪<>&", OperationID: math.MaxInt64, Details: map[string]any{"only": []any{uint64(math.MaxUint64), int64(math.MinInt64), "9007199254740993", nil, true}}}
	case "history_contract_events":
		return nativeTableFixture()
	default:
		return operationTestRow(1)
	}
}

func TestTypedMetadataReuseForcedFallbackParity(t *testing.T) {
	for _, dataset := range []string{"history_effects", "history_contract_events", "history_operations"} {
		for _, pending := range []int{0, 2} {
			t.Run(fmt.Sprintf("%s/pending=%d", dataset, pending), func(t *testing.T) {
				var captures [2]effectsTestCapture
				for mode := range captures {
					w := metadataReuseWriter(t, dataset, mode == 1, pending, &captures[mode])
					w.tables[dataset] = &tableBuffer{nextRow: math.MaxUint64 - 2}
					for i := 0; i < 2; i++ {
						fixture := metadataReuseFixture(dataset)
						if i == 1 {
							// Existing JSON normalization replaces invalid UTF-8;
							// metadata reuse must not change that payload behavior.
							switch row := fixture.(type) {
							case transform.EffectOutput:
								row.Address = string([]byte{255})
								fixture = row
							case transform.ContractEventOutput:
								row.TransactionHash = string([]byte{255})
								fixture = row
							case transform.OperationOutput:
								row.SourceAccount = string([]byte{255})
								fixture = row
							}
						}
						body, err := w.PrepareRow(dataset, fixture)
						if err != nil {
							t.Fatal(err)
						}
						// Duplicate reserved keys contain malicious values. Existing
						// append semantics must override them with writer metadata.
						body = append(bytes.Clone(body[:len(body)-1]), []byte(`,"_batch_id":"bad","_batch_id":null,"_source_sha256":false,"_ledger_sequence":-1,"_row_number":"bad","_ingested_at":"not-time"}`)...)
						before := bytes.Clone(body)
						if err := w.EmitPrepared(context.Background(), dataset, math.MaxUint32, body); err != nil {
							t.Fatal(err)
						}
						if !bytes.Equal(body, before) {
							t.Fatal("EmitPrepared mutated caller bytes")
						}
						// Retained rows/typed buffers must not alias caller storage,
						// including the pending HTTP job after the second row.
						for j := range body {
							body[j] = 'x'
						}
					}
					if err := w.Flush(context.Background()); err != nil {
						t.Fatal(err)
					}
					if w.DatasetWriteStats().Rows != 2 || w.DatasetWriteStats().Chunks != 1 {
						t.Fatal("fallback ACK counts changed")
					}
					selected, _ := schema.Lookup(dataset)
					columns, err := schema.Columns(selected)
					if err != nil {
						t.Fatal(err)
					}
					if dataset == "history_operations" {
						columns = operationInsertColumns(columns)
					}
					ordinal := uint64(math.MaxUint64 - 2)
					for _, call := range captures[mode].calls {
						for _, block := range effectsTestBlocks(t, call.body) {
							for _, row := range block {
								for c, col := range columns {
									want := ""
									switch col.Name {
									case "_batch_id":
										want = w.identity.ID
									case "_source_sha256":
										want = w.identity.SourceSHA256
									case "_ledger_sequence":
										want = fmt.Sprint(uint32(math.MaxUint32))
									case "_row_number":
										want = fmt.Sprint(ordinal)
									case "_ingested_at":
										stamp, ok := row[c].(time.Time)
										if !ok || !stamp.Equal(w.ingestedAt.Truncate(time.Microsecond)) {
											t.Fatal("metadata timestamp changed")
										}
									}
									if want != "" && fmt.Sprint(row[c]) != want {
										t.Fatal("metadata value changed", col.Name)
									}
								}
								ordinal++
							}
						}
					}
					if ordinal != math.MaxUint64 {
						t.Fatal("metadata row order/count changed")
					}
				}
				effectsTestCompare(t, captures[0].calls, captures[1].calls, dataset != "history_operations")
			})
		}
	}
}

func TestTypedMetadataReuseFallbackErrors(t *testing.T) {
	for _, dataset := range []string{"history_effects", "history_contract_events", "history_operations"} {
		field, dynamic := "operation_id", "details"
		if dataset == "history_contract_events" {
			field, dynamic = "transaction_id", "data_decoded"
		}
		if dataset == "history_operations" {
			field, dynamic = "transaction_id", "details_json"
		}
		cases := []struct{ name, body, want string }{
			{"malformed", `{"` + dynamic + `":}`, ""},
			{"nonfinite", `{"` + dynamic + `":1e400}`, ""},
			{"unknown", `{"unknown_metadata_reuse":1}`, "unknown " + dataset + " column unknown_metadata_reuse"},
			{"payload before unknown", `{"` + field + `":"invalid","unknown_metadata_reuse":1}`, dataset + " column " + field + ":"},
		}
		for _, pending := range []int{0, 2} {
			for _, tc := range cases {
				t.Run(fmt.Sprintf("%s/%d/%s", dataset, pending, tc.name), func(t *testing.T) {
					var capture effectsTestCapture
					w := metadataReuseWriter(t, dataset, true, pending, &capture)
					body := json.RawMessage(tc.body)
					before := bytes.Clone(body)
					err := w.EmitPrepared(context.Background(), dataset, 1, body)
					if err == nil || (tc.want != "" && !strings.Contains(err.Error(), tc.want)) {
						t.Fatal("fallback error priority changed", err)
					}
					if !bytes.Equal(body, before) {
						t.Fatal("rejected input mutated")
					}
					_ = w.Flush(context.Background())
					_ = w.WaitPending(context.Background())
					if len(capture.calls) != 0 || w.DatasetWriteStats().Rows != 0 || w.DatasetWriteStats().Chunks != 0 {
						t.Fatal("rejected fallback issued HTTP or ACK")
					}
				})
			}
		}
	}
}

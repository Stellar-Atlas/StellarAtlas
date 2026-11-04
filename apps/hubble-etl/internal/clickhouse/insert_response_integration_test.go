package clickhouse

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

type responseMetadataErrorBody struct{}

func (responseMetadataErrorBody) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
func (responseMetadataErrorBody) Close() error             { return nil }

func TestInsertResponseObservationDoesNotChangeRequestsOrErrors(t *testing.T) {
	const body = "{\"ledger_sequence\":1}\n"
	const summary = `{"elapsed_ns":"1000","written_rows":"1","written_bytes":23,"private":"must-not-escape"}`
	transportError := errors.New("synthetic transport failure")
	for _, scenario := range []string{"normal", "missing", "http-error", "body-error", "transport-error"} {
		t.Run(scenario, func(t *testing.T) {
			calls := 0
			client, err := New(Config{Endpoint: "http://offline.invalid", Database: "metadata_test", HTTPClient: &http.Client{Transport: effectsTestTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				payload, err := io.ReadAll(r.Body)
				if err != nil || string(payload) != body || r.URL.Query().Get("param_token") != "metadata-test" {
					t.Error("request body or immutable token changed")
				}
				if r.URL.Query().Get("query") != "INSERT INTO `metadata_test`.`history_ledgers` SETTINGS async_insert=0, insert_deduplication_token={token:String}, date_time_input_format='best_effort' FORMAT JSONEachRow" {
					t.Error("observation changed the existing synchronous INSERT")
				}
				if scenario == "transport-error" {
					return nil, transportError
				}
				response := &http.Response{StatusCode: http.StatusOK, Header: http.Header{"X-Clickhouse-Summary": []string{summary}}, Body: io.NopCloser(strings.NewReader("ok"))}
				if scenario == "missing" {
					response.Header = nil
				}
				if scenario == "http-error" {
					response.StatusCode = http.StatusServiceUnavailable
				}
				if scenario == "body-error" {
					response.Body = responseMetadataErrorBody{}
				}
				return response, nil
			})}})
			if err != nil {
				t.Fatal(err)
			}
			var timings insertTimings
			err = client.insert(context.Background(), "history_ledgers", "metadata-test", []byte(body), &timings)
			failed := scenario != "normal" && scenario != "missing"
			if calls != 1 || (err != nil) != failed || timings.responses.calls != 1 || (timings.responses.failed == 1) != failed {
				t.Fatal("HTTP call count or original failure outcome changed", calls, err)
			}
			if scenario == "transport-error" && !errors.Is(err, transportError) {
				t.Fatal("transport error identity was lost")
			}
			if scenario == "body-error" && !errors.Is(err, io.ErrUnexpectedEOF) {
				t.Fatal("body-read error identity was lost")
			}
			var writer BatchWriter
			writer.mergeInsertTimings("history_ledgers", timings)
			stats := writer.DatasetWriteStats()
			if len(stats.InsertResponses) != 1 {
				t.Fatal("missing finite dataset summary")
			}
			metric := stats.InsertResponses[0].ReportedWrittenRows
			unknown := scenario == "missing" || scenario == "transport-error"
			if (metric.ObservedTotal == nil) != unknown || (metric.UnknownResponses == 1) != unknown {
				t.Fatal("unknown response metadata fabricated a numeric value", metric)
			}
			encoded, err := json.Marshal(stats)
			if err != nil || strings.Contains(string(encoded), "must-not-escape") || strings.Contains(string(encoded), "INSERT INTO") {
				t.Fatal("summary retained non-allowlisted content")
			}
		})
	}
}

func TestInsertResponseSummaryMergesSerialAndPendingJobs(t *testing.T) {
	for _, pending := range []int{0, 2} {
		t.Run(strconv.Itoa(pending), func(t *testing.T) {
			var capture effectsTestCapture
			transport := effectsTestTransport(func(r *http.Request) (*http.Response, error) {
				response, err := capture.RoundTrip(r)
				response.Header.Set("X-ClickHouse-Summary", `{"elapsed_ns":10,"written_rows":"2","written_bytes":"100"}`)
				return response, err
			})
			writer := nativeTestWriter(t, false, false, pending, 2, 1<<20, transport)
			for i := 0; i < 5; i++ {
				if err := writer.Emit(context.Background(), "history_ledgers", 1, map[string]any{"sequence": i}); err != nil {
					t.Fatal(err)
				}
			}
			if err := writer.Flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			stats := writer.DatasetWriteStats()
			if stats.Rows != 5 || stats.Chunks != 3 || len(capture.calls) != 3 || len(stats.InsertResponses) != 1 {
				t.Fatal("observation changed rows, chunks or HTTP calls")
			}
			table := stats.InsertResponses[0]
			if table.Dataset != "history_ledgers" || table.Calls != 3 || table.FailedCalls != 0 || table.ReportedWrittenRows.ObservedTotal == nil || *table.ReportedWrittenRows.ObservedTotal != 6 {
				t.Fatal("response counters were not merged exactly once", table)
			}
			// Reported rows deliberately differ from acknowledged logical rows:
			// metadata must never become a publication/recovery authority.
			if table.ReportedWrittenRows.KnownResponses != 3 || table.ReportedWrittenRows.UnknownResponses != 0 {
				t.Fatal("response coverage count changed")
			}
		})
	}
}

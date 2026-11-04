package clickhouse

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBulkReserveUsesUnreservedSpaceAndFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		value   string
		blocked bool
	}{
		{"536870912000", false}, {"536870911999", true}, {"", true}, {"malformed", true},
	} {
		t.Run(tc.value, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("param_disk") != "default" {
					t.Error("missing typed disk parameter")
				}
				fmt.Fprintln(w, tc.value)
			}))
			defer server.Close()
			client, err := New(Config{Endpoint: server.URL, Database: "test"})
			if err != nil {
				t.Fatal(err)
			}
			if err := client.CheckBulkReserve(context.Background()); (err != nil) != tc.blocked {
				t.Fatalf("blocked=%v error=%v", tc.blocked, err)
			}
		})
	}
}

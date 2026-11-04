package clickhouse

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

type endpointTestTransport func(*http.Request) (*http.Response, error)

func (f endpointTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestClickHouseQueryDoesNotChangeConfiguredDestination(t *testing.T) {
	const endpoint = "https://clickhouse.invalid:8123/proxy%2Fsql?keep=a&keep=b&query=replace"
	const query = "SELECT '//other.invalid/#?x=y&query=injected'"
	const payload = "https://other.invalid/#?keep=overwrite&query=injected"
	var calls int
	transport := endpointTestTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodPost || r.URL.Scheme != "https" ||
			r.URL.Host != "clickhouse.invalid:8123" || r.URL.EscapedPath() != "/proxy%2Fsql" || r.URL.Fragment != "" {
			t.Fatalf("unexpected request method or URL: %s %s", r.Method, r.URL)
		}
		want := url.Values{"keep": {"a", "b"}, "query": {query}, "param_name": {payload, "other"}}
		if got := r.URL.Query(); !reflect.DeepEqual(got, want) {
			t.Fatalf("unexpected query values: %v", got)
		}
		body, err := io.ReadAll(r.Body)
		user, password, ok := r.BasicAuth()
		if err != nil || string(body) != "row data" || !ok || user != "etl" || password != "fixture" ||
			r.Header.Get("Content-Type") != "application/octet-stream" {
			t.Fatal("request body, auth, or content type was not preserved")
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("ok")), Request: r}, nil
	})
	client, err := New(Config{Endpoint: endpoint, Database: "test_db", User: "etl", Password: "fixture", HTTPClient: &http.Client{Transport: transport}})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.execute(context.Background(), query, url.Values{"param_name": {payload, "other"}}, []byte("row data"))
	if err != nil || calls != 1 || string(result) != "ok" {
		t.Fatalf("expected exactly one successful request, got calls=%d body=%q err=%v", calls, result, err)
	}
}

func TestClickHouseRejectsRedirectsBeforeReplayingRequest(t *testing.T) {
	for _, tc := range []struct {
		name, location string
		status         int
	}{
		{"cross-origin", "https://other.invalid/collect", http.StatusTemporaryRedirect},
		{"same-origin", "/different/path", http.StatusPermanentRedirect},
		{"method-changing", "//other.invalid/collect", http.StatusFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls int
			redirectHook := func(*http.Request, []*http.Request) error {
				t.Fatal("ClickHouse request must not use the supplied redirect hook")
				return nil
			}
			base := &http.Client{CheckRedirect: redirectHook, Transport: endpointTestTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				if calls != 1 || r.URL.Host != "clickhouse.invalid" || r.URL.Path != "/sql" {
					t.Fatalf("request reached unexpected destination: %s", r.URL)
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Location": {tc.location}}, Body: http.NoBody, Request: r}, nil
			})}
			client, err := New(Config{Endpoint: "https://clickhouse.invalid/sql", Database: "test_db", HTTPClient: base})
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.execute(context.Background(), "SELECT 1", nil, []byte("must not replay"))
			var requestErr *RequestError
			if !errors.As(err, &requestErr) || calls != 1 || !strings.Contains(err.Error(), "ClickHouse HTTP ") {
				t.Fatalf("expected one request and classified redirect error; calls=%d err=%v", calls, err)
			}
			if reflect.ValueOf(base.CheckRedirect).Pointer() != reflect.ValueOf(redirectHook).Pointer() {
				t.Fatal("construction mutated the caller's HTTP client")
			}
		})
	}
}

func TestClickHouseRejectsAmbiguousConfiguredEndpoints(t *testing.T) {
	for _, endpoint := range []string{
		"/relative", "http:opaque", "ftp://clickhouse.invalid/", "http://:8123/",
		"http://user:fixture@clickhouse.invalid/", "http://clickhouse.invalid/#",
		"http://clickhouse.invalid/?broken=%", "http://clickhouse.invalid/?x=1;y=2",
	} {
		if _, err := New(Config{Endpoint: endpoint, Database: "test_db"}); err == nil {
			t.Errorf("accepted invalid endpoint %q", endpoint)
		}
	}
}

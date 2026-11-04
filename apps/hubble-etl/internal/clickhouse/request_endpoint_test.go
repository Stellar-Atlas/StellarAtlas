package clickhouse

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"testing"
	"time"
)

type endpointTestTransport func(*http.Request) (*http.Response, error)

func (f endpointTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestClickHouseDirectTransportIgnoresAmbientProxy(t *testing.T) {
	// net/http caches its proxy environment process-wide. Exercise it in a fresh
	// copy of this test binary so other tests cannot affect the control.
	const child = "HUBBLE_TEST_DIRECT_TRANSPORT_CHILD"
	if os.Getenv(child) != "1" {
		t.Setenv(child, "1")
		cmd := exec.CommandContext(t.Context(), os.Args[0], "-test.run=^TestClickHouseDirectTransportIgnoresAmbientProxy$")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated transport test: %v\n%s", err, output)
		}
		return
	}
	const endpoint = "http://warehouse.invalid:8123/sql"
	const ambient = "http://unrelated-proxy.invalid:3128"
	t.Setenv("HTTP_PROXY", ambient)
	t.Setenv("NO_PROXY", "unused.invalid")
	t.Setenv("REQUEST_METHOD", "")
	req, err := http.NewRequest(http.MethodPost, endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	if proxy, err := http.ProxyFromEnvironment(req); err != nil || proxy == nil || proxy.String() != ambient {
		t.Fatalf("control request did not select the ambient proxy: %v, %v", proxy, err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		user, pass, auth := r.BasicAuth()
		if err != nil || r.Method != http.MethodPost || r.Host != "warehouse.invalid:8123" ||
			r.URL.Path != "/sql" || r.URL.Query().Get("query") != "SELECT 1" ||
			!auth || user != "etl" || pass != "fixture" || string(body) != "row data" {
			t.Error("direct request did not preserve the endpoint or payload")
		}
		_, _ = io.WriteString(w, "ok")
	}))
	defer server.Close()
	base := &http.Client{Timeout: 5 * time.Second}
	client, err := New(Config{Endpoint: endpoint, Database: "test_db", User: "etl", Password: "fixture", HTTPClient: base})
	if err != nil {
		t.Fatal(err)
	}
	if base.Transport != nil || client.http.Timeout != base.Timeout {
		t.Fatal("construction mutated the supplied client or changed its timeout")
	}
	transport := client.http.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	direct := transport.(*http.Transport).Clone()
	defer direct.CloseIdleConnections()
	direct.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "warehouse.invalid:8123" {
			return nil, errors.New("request tried to dial an unexpected destination: " + address)
		}
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	client.http.Transport = direct
	ctx, cancel := context.WithTimeout(t.Context(), base.Timeout)
	defer cancel()
	got, err := client.execute(ctx, "SELECT 1", nil, []byte("row data"))
	if err != nil || string(got) != "ok" {
		t.Fatalf("expected a successful direct POST, got %q, %v", got, err)
	}
}

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

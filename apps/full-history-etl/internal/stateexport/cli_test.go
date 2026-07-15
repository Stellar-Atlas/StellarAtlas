package stateexport_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/stateexport"
)

func TestMainRejectsMalformedArguments(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want string
	}{
		{name: "missing flags", want: "unsupported dataset"},
		{name: "unsupported dataset", args: []string{"--dataset", "offers", "--input", "fixture.parquet"}, want: "unsupported dataset"},
		{name: "missing input", args: []string{"--dataset", "account-state-changes"}, want: "input path is required"},
		{name: "duplicate dataset", args: []string{"--dataset", "account-state-changes", "--dataset", "account-state-changes", "--input", "fixture.parquet"}, want: "provided only once"},
		{name: "duplicate input", args: []string{"--dataset", "account-state-changes", "--input", "one.parquet", "--input", "two.parquet"}, want: "provided only once"},
		{name: "positional", args: []string{"--dataset", "account-state-changes", "--input", "fixture.parquet", "extra"}, want: "unexpected positional"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if code := stateexport.Main(test.args, &stdout, &stderr); code == 0 {
				t.Fatal("malformed arguments returned success")
			}
			if stdout.Len() != 0 {
				t.Fatalf("error wrote to stdout: %q", stdout.String())
			}
			if !strings.Contains(stderr.String(), test.want) || !strings.HasSuffix(stderr.String(), "\n") {
				t.Fatalf("stderr %q does not contain %q", stderr.String(), test.want)
			}
		})
	}
}

func TestMainRejectsNonRegularInputBeforeHeader(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := stateexport.Main([]string{
		"--dataset", "account-state-changes", "--input", t.TempDir(),
	}, &stdout, &stderr)
	if code == 0 || !strings.Contains(stderr.String(), "not a regular file") {
		t.Fatalf("expected regular-file error, code=%d stderr=%q", code, stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("preflight error wrote a header: %q", stdout.String())
	}
}

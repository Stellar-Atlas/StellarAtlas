package backfill

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestPressureAdmission(t *testing.T) {
	for _, tc := range []struct {
		name, psi, queue string
		blocked          bool
	}{
		{"healthy", "some avg10=0.10\nfull avg10=0.05", "0 0", false},
		{"threshold inclusive", "some avg10=30.00\nfull avg10=20.00", "128 128", false},
		{"some pressure", "some avg10=30.01\nfull avg10=0.00", "0 0", true},
		{"full pressure", "some avg10=21.00\nfull avg10=20.01", "0 0", true},
		{"queue pressure", "some avg10=0\nfull avg10=0", "128 129", true},
		{"missing full", "some avg10=0", "0 0", true},
		{"invalid pressure", "some avg10=NaN\nfull avg10=0", "0 0", true},
		{"invalid queue", "some avg10=0\nfull avg10=0", "bad 0", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			guard := PressureGuard{MaximumFullBasisPoints: 2000, MaximumSomeBasisPoints: 3000, MaximumInflight: 256}
			reason := guard.reason(func(path string) ([]byte, error) {
				if strings.HasSuffix(path, "inflight") {
					return []byte(tc.queue), nil
				}
				return []byte(tc.psi), nil
			})
			if (reason != "") != tc.blocked {
				t.Fatalf("unexpected admission: %q", reason)
			}
		})
	}
}

func TestPressureProbeFailureAndCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	guard := PressureGuard{
		read: func(string) ([]byte, error) { return nil, errors.New("probe unavailable") },
		wait: func(ctx context.Context) error { cancel(); return ctx.Err() },
	}
	if err := guard.Wait(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
}

func TestPressureRecoveryLogsTransitionsOnly(t *testing.T) {
	attempts := 0
	var events []string
	guard := PressureGuard{
		MaximumFullBasisPoints: 2000, MaximumSomeBasisPoints: 3000, MaximumInflight: 256,
		read: func(path string) ([]byte, error) {
			if strings.HasSuffix(path, "inflight") {
				return []byte("0 0"), nil
			}
			if attempts < 2 {
				return []byte("some avg10=40\nfull avg10=30"), nil
			}
			return []byte("some avg10=0\nfull avg10=0"), nil
		},
		wait: func(context.Context) error { attempts++; return nil },
		Log:  func(event, reason string) { events = append(events, event) },
	}
	if err := guard.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := guard.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if attempts != 2 || strings.Join(events, ",") != "admission-deferred,admission-resumed" {
		t.Fatalf("attempts=%d events=%v", attempts, events)
	}
}

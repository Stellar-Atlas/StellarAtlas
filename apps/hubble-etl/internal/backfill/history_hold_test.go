package backfill

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestHistoryHoldDisabledDoesNotProbe(t *testing.T) {
	var absent *HistoryAdmissionHold
	disabled := &HistoryAdmissionHold{probe: func(string) string { panic("disabled marker access") }}
	for _, hold := range []*HistoryAdmissionHold{absent, disabled} {
		if err := hold.Wait(context.Background()); err != nil || hold.blocked() {
			t.Fatalf("disabled hold: %v", err)
		}
	}
}

func TestHistoryHoldTransitionsResumeAndCancel(t *testing.T) {
	var events []string
	checks := 0
	hold := &HistoryAdmissionHold{
		MarkerPath: "/run/test/history-hold",
		probe: func(string) string {
			checks++
			if checks <= 3 {
				return "unsafe or held"
			}
			return ""
		},
		wait: func(context.Context) error { return nil },
		Log:  func(event, _ string) { events = append(events, event) },
	}
	if err := hold.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(events, []string{"history-admission-held", "history-admission-resumed"}) {
		t.Fatalf("events = %v", events)
	}
	ctx, cancel := context.WithCancel(context.Background())
	hold.probe = func(string) string { return "unreadable control" }
	hold.wait = func(context.Context) error { cancel(); return ctx.Err() }
	if err := hold.Wait(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled hold: %v", err)
	}
}

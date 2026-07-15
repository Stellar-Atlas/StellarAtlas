package stateexport

import (
	"context"
	"fmt"
	"io"
	"strings"
)

func Main(args []string, stdout, stderr io.Writer) int {
	return MainContext(context.Background(), args, stdout, stderr)
}

func MainContext(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if stderr == nil {
		stderr = io.Discard
	}
	err := rejectRepeatedValueFlags(args)
	var config Config
	if err == nil {
		config, err = ParseConfig(args, io.Discard)
	}
	if err == nil {
		_, err = Export(ctx, config, stdout)
	}
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "full-history-state-export: %v\n", err)
		return 1
	}
	return 0
}

func rejectRepeatedValueFlags(args []string) error {
	counts := map[string]int{"dataset": 0, "input": 0}
	for _, argument := range args {
		if !strings.HasPrefix(argument, "-") {
			continue
		}
		trimmed := strings.TrimLeft(argument, "-")
		for name := range counts {
			if trimmed == name || strings.HasPrefix(trimmed, name+"=") {
				counts[name]++
			}
		}
	}
	for _, name := range []string{"dataset", "input"} {
		if counts[name] > 1 {
			return fmt.Errorf("--%s may be provided only once", name)
		}
	}
	return nil
}

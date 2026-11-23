package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/app"
)

func main() { os.Exit(run()) }

func run() int {
	c, err := app.ParseMaterializationConfig(os.Args[1:], os.Stderr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "full-history-materialize: invalid trusted configuration:", err)
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()
	err = app.WithMaterializedOutput(ctx, c, func(result app.MaterializedOutput) error {
		if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
			return err
		}
		ack := make(chan error, 1)
		input := bufio.NewReader(io.LimitReader(os.Stdin, 16))
		go func() {
			line, err := input.ReadString('\n')
			if err == nil && line != "opened\n" {
				err = fmt.Errorf("invalid file-open acknowledgement")
			}
			ack <- err
		}()
		timer := time.NewTimer(10 * time.Second)
		defer timer.Stop()
		select {
		case err := <-ack:
			if err != nil || !result.Transient {
				return err
			}
		case <-timer.C:
			return fmt.Errorf("file-open acknowledgement expired")
		case <-ctx.Done():
			return ctx.Err()
		}
		// The build deadline does not cut off a download already being read.
		// The parent sends this only after closing the FD, or closes stdin
		// on exit; either releases the shared lock and cleans the RAM scratch.
		line, err := input.ReadString('\n')
		if err != nil || line != "closed\n" {
			return fmt.Errorf("temporary response lease closed without acknowledgement")
		}
		return nil
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "full-history-materialize:", err)
		return 1
	}
	return 0
}

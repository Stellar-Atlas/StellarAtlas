package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/app"
)

func main() {
	os.Exit(run())
}

func run() int {
	config, err := app.ParseTransactionReconstructionConfig(os.Args[1:], os.Stderr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "full-history-reconstruct: %v\n", err)
		return 2
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	receipt, err := app.RunTransactionReconstruction(ctx, config)
	if err != nil {
		fmt.Fprintf(os.Stderr, "full-history-reconstruct: %v\n", err)
		return 1
	}
	if err := json.NewEncoder(os.Stdout).Encode(receipt); err != nil {
		fmt.Fprintf(os.Stderr, "full-history-reconstruct: encode result: %v\n", err)
		return 1
	}
	return 0
}

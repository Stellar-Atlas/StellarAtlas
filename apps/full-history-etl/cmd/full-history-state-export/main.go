package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/stateexport"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	os.Exit(stateexport.MainContext(ctx, os.Args[1:], os.Stdout, os.Stderr))
}

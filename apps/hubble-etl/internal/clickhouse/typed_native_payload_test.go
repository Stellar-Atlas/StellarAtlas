package clickhouse

import (
	"bytes"
	"context"
	"errors"
	"testing"
)

func TestTypedNativePayloadRetainsOwnedSingleBlock(t *testing.T) {
	for _, blocks := range [][][]byte{nil, {[]byte("first")}, {[]byte("first"), []byte("second")}} {
		chunk := &typedNativeChunk{blocks: blocks}
		want := bytes.Join(blocks, nil)
		for attempt := 0; attempt < 2; attempt++ {
			got, err := chunk.payload(context.Background())
			if err != nil || !bytes.Equal(got, want) {
				t.Fatalf("attempt %d changed payload: %q, %v", attempt, got, err)
			}
			if len(blocks) == 1 && &got[0] != &blocks[0][0] {
				t.Fatal("single immutable block was copied")
			}
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if got, err := chunk.payload(ctx); got != nil || !errors.Is(err, context.Canceled) {
			t.Fatal("canceled payload was returned", err)
		}
	}
}

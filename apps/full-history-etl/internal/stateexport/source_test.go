package stateexport_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/stateexport"
)

func TestExportRejectsSourceMutationBeforeCompletion(t *testing.T) {
	path := writeParquet(t, "ledgers.parquet", []model.Ledger{validLedger(1, "a")})
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read parquet fixture: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat parquet fixture: %v", err)
	}
	mutate := func() error {
		file, err := os.OpenFile(path, os.O_WRONLY, 0)
		if err != nil {
			return err
		}
		changed := []byte{contents[len(contents)-1] ^ 0xff}
		if _, err = file.WriteAt(changed, int64(len(contents)-1)); err == nil {
			err = file.Sync()
		}
		err = errors.Join(err, file.Close())
		if err != nil {
			return err
		}
		return os.Chtimes(path, info.ModTime(), info.ModTime())
	}

	assertChangedSourceFails(t, path, mutate, "input changed while being exported")
}

func TestExportRejectsSourcePathReplacementBeforeCompletion(t *testing.T) {
	path := writeParquet(t, "ledgers.parquet", []model.Ledger{validLedger(1, "a")})
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read parquet fixture: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat parquet fixture: %v", err)
	}
	replace := func() error {
		if err := os.Rename(path, path+".opened"); err != nil {
			return err
		}
		return os.WriteFile(path, contents, info.Mode().Perm())
	}

	assertChangedSourceFails(t, path, replace, "input path was replaced while being exported")
}

func assertChangedSourceFails(t *testing.T, path string, change func() error, want string) {
	t.Helper()
	var output bytes.Buffer
	writer := &afterFirstWrite{output: &output, action: change}
	count, err := stateexport.Export(context.Background(), stateexport.Config{
		Dataset: stateexport.Ledgers, InputPath: path,
	}, writer)
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("changed source returned count=%d err=%v, expected %q", count, err, want)
	}
	if writer.actionErr != nil {
		t.Fatalf("change source after header: %v", writer.actionErr)
	}
	for _, record := range decodeLines(t, output.Bytes(), stateexport.MaxNDJSONLineBytes) {
		if record.Type == "complete" {
			t.Fatalf("changed source emitted completion: %s", output.String())
		}
	}
}

type afterFirstWrite struct {
	output    io.Writer
	action    func() error
	actionErr error
	triggered bool
}

func (w *afterFirstWrite) Write(data []byte) (int, error) {
	written, err := w.output.Write(data)
	if err == nil && !w.triggered {
		w.triggered = true
		w.actionErr = w.action()
		if w.actionErr != nil {
			return written, fmt.Errorf("change source: %w", w.actionErr)
		}
	}
	return written, err
}

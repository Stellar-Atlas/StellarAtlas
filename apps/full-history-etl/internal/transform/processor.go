package transform

import (
	"context"
	"fmt"

	batchinput "github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/input"
	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/output"
	"github.com/stellar/go-stellar-sdk/xdr"
)

type Processor struct {
	outputs           *output.Collection
	networkPassphrase string
	maxRows           uint64
	rows              uint64
}

func NewProcessor(outputs *output.Collection, networkPassphrase string, maxRows uint64) (*Processor, error) {
	if outputs == nil {
		return nil, fmt.Errorf("outputs are required")
	}
	if networkPassphrase == "" {
		return nil, fmt.Errorf("network passphrase is required")
	}
	if maxRows == 0 {
		return nil, fmt.Errorf("row limit must be positive")
	}
	return &Processor{outputs: outputs, networkPassphrase: networkPassphrase, maxRows: maxRows}, nil
}

func (p *Processor) Process(ctx context.Context, batch *batchinput.Batch, maxDecodedMemoryBytes int64) error {
	expectedSequence := batch.Start
	err := batch.ForEach(maxDecodedMemoryBytes, func(meta xdr.LedgerCloseMeta) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if meta.LedgerSequence() != expectedSequence {
			return fmt.Errorf("decoded ledger sequence %d does not match expected sequence %d", meta.LedgerSequence(), expectedSequence)
		}
		if err := p.processLedgerSafely(meta); err != nil {
			return fmt.Errorf("transform ledger %d: %w", expectedSequence, err)
		}
		expectedSequence++
		return nil
	})
	if err != nil {
		return err
	}
	if expectedSequence-1 != batch.End {
		return fmt.Errorf("transformed through ledger %d, expected %d", expectedSequence-1, batch.End)
	}
	return nil
}

func (p *Processor) processLedgerSafely(meta xdr.LedgerCloseMeta) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("stellar SDK rejected semantic XDR: %v", recovered)
		}
	}()
	return p.processLedger(meta)
}

func (p *Processor) processLedger(meta xdr.LedgerCloseMeta) error {
	header := meta.LedgerHeaderHistoryEntry()
	computedHash, err := xdr.HashXdr(&header.Header)
	if err != nil {
		return fmt.Errorf("hash ledger header: %w", err)
	}
	if computedHash != header.Hash {
		return fmt.Errorf("ledger header hash mismatch: declared %s, computed %s", header.Hash.HexString(), computedHash.HexString())
	}
	if len(meta.TransactionEnvelopes()) != meta.CountTransactions() {
		return fmt.Errorf("transaction set count %d does not match result/meta count %d", len(meta.TransactionEnvelopes()), meta.CountTransactions())
	}

	transactions, err := bindTransactions(meta, p.networkPassphrase)
	if err != nil {
		return err
	}
	if len(transactions) != meta.CountTransactions() {
		return fmt.Errorf("read %d transactions, expected %d", len(transactions), meta.CountTransactions())
	}

	if err := p.claim("ledger-close-meta", 1); err != nil {
		return err
	}
	if err := p.outputs.LedgerCloseMeta.Write(meta); err != nil {
		return err
	}
	ledgerRow, err := makeLedger(meta)
	if err != nil {
		return err
	}
	if err := p.claim("ledgers", 1); err != nil {
		return err
	}
	if err := p.outputs.Ledgers.Write(ledgerRow); err != nil {
		return err
	}

	for i := range transactions {
		if err := p.processTransaction(&transactions[i]); err != nil {
			return fmt.Errorf("transaction %d: %w", transactions[i].Index, err)
		}
	}
	if err := p.writeUpgradeChanges(meta); err != nil {
		return err
	}
	return nil
}

func (p *Processor) claim(dataset string, count uint64) error {
	if count > p.maxRows-p.rows {
		return fmt.Errorf("%s would exceed aggregate row limit %d", dataset, p.maxRows)
	}
	p.rows += count
	return nil
}

package projector

import (
	"context"
	"fmt"

	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/internal/input"
	"github.com/stellar/stellar-etl/v2/internal/transform"
)

type Emitter interface {
	Emit(context.Context, string, uint32, any) error
}

type Projector struct {
	networkPassphrase string
	emitter           Emitter
}

func New(networkPassphrase string, emitter Emitter) (*Projector, error) {
	if networkPassphrase == "" {
		return nil, fmt.Errorf("network passphrase is required")
	}
	if emitter == nil {
		return nil, fmt.Errorf("row emitter is required")
	}
	return &Projector{networkPassphrase: networkPassphrase, emitter: emitter}, nil
}

func (p *Projector) ProcessLedger(
	ctx context.Context,
	meta xdr.LedgerCloseMeta,
) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("stellar-etl rejected ledger %d: %v", meta.LedgerSequence(), recovered)
		}
	}()
	if err := ctx.Err(); err != nil {
		return err
	}
	sequence := meta.LedgerSequence()
	historyLedger := input.HistoryArchiveLedgerFromLCM(meta)
	ledger, err := transform.TransformLedger(historyLedger, meta)
	if err != nil {
		return fmt.Errorf("transform ledger %d: %w", sequence, err)
	}
	if err := p.emit(ctx, "history_ledgers", sequence, ledger); err != nil {
		return err
	}
	if err := p.projectTransactions(ctx, meta); err != nil {
		return err
	}
	if err := p.projectOperations(ctx, meta); err != nil {
		return err
	}
	if err := p.projectAssets(ctx, meta); err != nil {
		return err
	}
	if err := p.projectTrades(ctx, meta); err != nil {
		return err
	}
	transfers, err := p.transformTokenTransfers(meta)
	if err != nil {
		return fmt.Errorf("transform token transfers at ledger %d: %w", sequence, err)
	}
	for _, transfer := range transfers {
		if err := p.emit(ctx, "token_transfers", sequence, transfer); err != nil {
			return err
		}
	}
	if err := p.projectStateChanges(ctx, meta); err != nil {
		return err
	}
	return nil
}

func (p *Projector) projectTransactions(
	ctx context.Context,
	meta xdr.LedgerCloseMeta,
) error {
	sequence := meta.LedgerSequence()
	transactions, err := input.TransactionsFromLedger(meta, p.networkPassphrase)
	if err != nil {
		return fmt.Errorf("read transactions at ledger %d: %w", sequence, err)
	}
	for _, item := range transactions {
		transaction, err := transform.TransformTransaction(
			item.Transaction,
			item.LedgerHistory,
		)
		if err != nil {
			return fmt.Errorf("transform transaction at ledger %d: %w", sequence, err)
		}
		if err := p.emit(ctx, "history_transactions", sequence, transaction); err != nil {
			return err
		}
		ledgerTransaction, err := transform.TransformLedgerTransaction(
			item.Transaction,
			item.LedgerHistory,
		)
		if err != nil {
			return fmt.Errorf("transform ledger transaction at ledger %d: %w", sequence, err)
		}
		if err := p.emit(ctx, "ledger_transactions", sequence, ledgerTransaction); err != nil {
			return err
		}
		effects, err := transform.TransformEffect(
			item.Transaction,
			sequence,
			meta,
			p.networkPassphrase,
		)
		if err != nil {
			return fmt.Errorf("transform effects at ledger %d: %w", sequence, err)
		}
		for _, effect := range effects {
			if err := p.emit(ctx, "history_effects", sequence, effect); err != nil {
				return err
			}
		}
		events, err := transform.TransformContractEvent(
			item.Transaction,
			item.LedgerHistory,
		)
		if err != nil {
			return fmt.Errorf("transform contract events at ledger %d: %w", sequence, err)
		}
		for _, event := range events {
			if err := p.emit(ctx, "history_contract_events", sequence, event); err != nil {
				return err
			}
		}
	}
	return nil
}

func (p *Projector) projectOperations(
	ctx context.Context,
	meta xdr.LedgerCloseMeta,
) error {
	sequence := meta.LedgerSequence()
	operations, err := input.OperationsFromLedger(meta, p.networkPassphrase)
	if err != nil {
		return fmt.Errorf("read operations at ledger %d: %w", sequence, err)
	}
	for _, item := range operations {
		operation, err := transform.TransformOperation(
			item.Operation,
			item.OperationIndex,
			item.Transaction,
			item.LedgerSeqNum,
			item.LedgerCloseMeta,
			p.networkPassphrase,
		)
		if err != nil {
			return fmt.Errorf("transform operation at ledger %d: %w", sequence, err)
		}
		if err := p.emit(ctx, "history_operations", sequence, operation); err != nil {
			return err
		}
	}
	return nil
}

func (p *Projector) projectAssets(
	ctx context.Context,
	meta xdr.LedgerCloseMeta,
) error {
	sequence := meta.LedgerSequence()
	for _, item := range input.PaymentOperationsFromLedger(meta) {
		asset, err := transform.TransformAsset(
			item.Operation,
			item.OperationIndex,
			item.TransactionIndex,
			item.LedgerSeqNum,
			item.LedgerCloseMeta,
		)
		if err != nil {
			return fmt.Errorf("transform asset at ledger %d: %w", sequence, err)
		}
		if err := p.emit(ctx, "history_assets", sequence, asset); err != nil {
			return err
		}
	}
	return nil
}

func (p *Projector) projectTrades(
	ctx context.Context,
	meta xdr.LedgerCloseMeta,
) error {
	sequence := meta.LedgerSequence()
	trades, err := input.TradesFromLedger(meta, p.networkPassphrase)
	if err != nil {
		return fmt.Errorf("read trades at ledger %d: %w", sequence, err)
	}
	for _, item := range trades {
		rows, err := transform.TransformTrade(
			item.OperationIndex,
			item.OperationHistoryID,
			item.Transaction,
			item.CloseTime,
		)
		if err != nil {
			return fmt.Errorf("transform trade at ledger %d: %w", sequence, err)
		}
		for _, trade := range rows {
			if err := p.emit(ctx, "history_trades", sequence, trade); err != nil {
				return err
			}
		}
	}
	return nil
}

func (p *Projector) emit(
	ctx context.Context,
	dataset string,
	sequence uint32,
	row any,
) error {
	if err := p.emitter.Emit(ctx, dataset, sequence, row); err != nil {
		return fmt.Errorf("emit %s at ledger %d: %w", dataset, sequence, err)
	}
	return nil
}

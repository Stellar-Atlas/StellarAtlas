package transform

// Transaction binding follows the Apache-2.0 LedgerTransactionReader algorithm
// in go-stellar-sdk: transaction-set order differs from processing order, so
// envelopes must be joined to result/meta records by network-specific hash.

import (
	"fmt"

	"github.com/stellar/go-stellar-sdk/network"
	"github.com/stellar/go-stellar-sdk/xdr"
)

type ledgerTransaction struct {
	Index               uint32
	Envelope            xdr.TransactionEnvelope
	Result              xdr.TransactionResultPair
	Meta                xdr.TransactionMeta
	FeeChanges          xdr.LedgerEntryChanges
	PostApplyFeeChanges xdr.LedgerEntryChanges
	Ledger              xdr.LedgerCloseMeta
	Hash                xdr.Hash
}

type transactionEvents struct {
	transaction []xdr.TransactionEvent
	operation   [][]xdr.ContractEvent
	diagnostic  []xdr.DiagnosticEvent
}

func bindTransactions(meta xdr.LedgerCloseMeta, passphrase string) ([]ledgerTransaction, error) {
	envelopes := meta.TransactionEnvelopes()
	byHash := make(map[xdr.Hash]xdr.TransactionEnvelope, len(envelopes))
	for index, envelope := range envelopes {
		hash, err := network.HashTransactionInEnvelope(envelope, passphrase)
		if err != nil {
			return nil, fmt.Errorf("hash transaction-set envelope %d: %w", index, err)
		}
		xdrHash := xdr.Hash(hash)
		if _, duplicate := byHash[xdrHash]; duplicate {
			return nil, fmt.Errorf("transaction set contains duplicate hash %s", xdrHash.HexString())
		}
		byHash[xdrHash] = envelope
	}

	transactions := make([]ledgerTransaction, 0, meta.CountTransactions())
	for index := 0; index < meta.CountTransactions(); index++ {
		hash := meta.TransactionHash(index)
		envelope, ok := byHash[hash]
		if !ok {
			return nil, fmt.Errorf("result/meta hash %s has no matching envelope for the configured network", hash.HexString())
		}
		delete(byHash, hash)
		var postApply xdr.LedgerEntryChanges
		if v2, ok := meta.GetV2(); ok {
			postApply = v2.TxProcessing[index].PostTxApplyFeeProcessing
		}
		transactions = append(transactions, ledgerTransaction{
			Index:               uint32(index + 1),
			Envelope:            envelope,
			Result:              meta.TransactionResultPair(index),
			Meta:                meta.TxApplyProcessing(index),
			FeeChanges:          meta.FeeProcessing(index),
			PostApplyFeeChanges: postApply,
			Ledger:              meta,
			Hash:                hash,
		})
	}
	if len(byHash) != 0 {
		return nil, fmt.Errorf("transaction set has %d envelopes without result/meta records", len(byHash))
	}
	return transactions, nil
}

func eventsForTransaction(transaction *ledgerTransaction) (transactionEvents, error) {
	var events transactionEvents
	if transaction.Meta.V == 0 {
		return events, nil
	}
	var err error
	events.transaction, err = transaction.Meta.GetTransactionEvents()
	if err != nil {
		return events, err
	}
	operationCount := operationMetaCount(transaction.Meta)
	if transaction.Meta.V == 3 && operationCount == 0 {
		operationCount = 1
	}
	events.operation = make([][]xdr.ContractEvent, operationCount)
	for index := 0; index < operationCount; index++ {
		events.operation[index], err = transaction.Meta.GetContractEventsForOperation(uint32(index))
		if err != nil {
			return events, err
		}
	}
	events.diagnostic, err = transaction.Meta.GetDiagnosticEvents()
	return events, err
}

func isSorobanEnvelope(envelope xdr.TransactionEnvelope) bool {
	switch envelope.Type {
	case xdr.EnvelopeTypeEnvelopeTypeTx:
		_, ok := envelope.V1.Tx.Ext.GetSorobanData()
		return ok
	case xdr.EnvelopeTypeEnvelopeTypeTxFeeBump:
		_, ok := envelope.FeeBump.Tx.InnerTx.V1.Tx.Ext.GetSorobanData()
		return ok
	default:
		return false
	}
}

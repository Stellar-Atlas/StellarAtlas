package projector

import (
	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/internal/input"
	"github.com/stellar/stellar-etl/v2/internal/toid"
	"github.com/stellar/stellar-etl/v2/internal/utils"
)

// Reuse the immutable transaction reader output within one ledger. These input
// mappings match stellar-etl v2.8.23; the official transforms still own each row.
// Per-table ordering and TOIDs must remain identical for replay deduplication.
func operationsFromTransactions(meta xdr.LedgerCloseMeta, transactions []input.LedgerTransformInput) []input.OperationTransformInput {
	var operations []input.OperationTransformInput
	for _, item := range transactions {
		for index, operation := range item.Transaction.Envelope.Operations() {
			operations = append(operations, input.OperationTransformInput{
				Operation: operation, OperationIndex: int32(index),
				Transaction: item.Transaction, LedgerSeqNum: int32(meta.LedgerSequence()),
				LedgerCloseMeta: meta,
			})
		}
	}
	return operations
}

func tradesFromTransactions(meta xdr.LedgerCloseMeta, transactions []input.LedgerTransformInput) []input.TradeTransformInput {
	closeTime, _ := utils.TimePointToUTCTimeStamp(meta.LedgerHeaderHistoryEntry().Header.ScpValue.CloseTime)
	var trades []input.TradeTransformInput
	for _, item := range transactions {
		if !item.Transaction.Result.Successful() {
			continue
		}
		for index, operation := range item.Transaction.Envelope.Operations() {
			switch operation.Body.Type {
			case xdr.OperationTypeManageBuyOffer, xdr.OperationTypeManageSellOffer,
				xdr.OperationTypeCreatePassiveSellOffer, xdr.OperationTypePathPaymentStrictSend,
				xdr.OperationTypePathPaymentStrictReceive:
				trades = append(trades, input.TradeTransformInput{
					OperationIndex: int32(index), Transaction: item.Transaction,
					CloseTime:          closeTime,
					OperationHistoryID: toid.New(int32(meta.LedgerSequence()), int32(item.Transaction.Index), int32(index)).ToInt64(),
				})
			}
		}
	}
	return trades
}

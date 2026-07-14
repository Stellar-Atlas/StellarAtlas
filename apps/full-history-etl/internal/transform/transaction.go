package transform

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/stellar/go-stellar-sdk/xdr"
)

type eventCounts struct {
	transaction int64
	operation   int64
	diagnostic  int64
}

func (p *Processor) processTransaction(transaction *ledgerTransaction) error {
	transactionHash := hex.EncodeToString(transaction.Hash[:])
	sequence := int64(transaction.Ledger.LedgerSequence())
	closedAt, err := unixMillis(uint64(transaction.Ledger.LedgerCloseTime()))
	if err != nil {
		return err
	}
	source, sourceMuxed, err := accountAddresses(transaction.Envelope.SourceAccount())
	if err != nil {
		return fmt.Errorf("decode source account: %w", err)
	}
	feeAccount, feeAccountMuxed, err := accountAddresses(transaction.Envelope.FeeAccount())
	if err != nil {
		return fmt.Errorf("decode fee account: %w", err)
	}
	signatureCount := len(transaction.Envelope.Signatures())
	feeBumpMaxFee := int64(0)
	if transaction.Envelope.IsFeeBump() {
		feeBumpMaxFee = transaction.Envelope.FeeBumpFee()
		if feeBumpMaxFee < 0 {
			return fmt.Errorf("negative fee-bump maximum fee")
		}
		signatureCount += len(transaction.Envelope.FeeBumpSignatures())
	}
	accountSequence := transaction.Envelope.SeqNum()
	if accountSequence < 0 {
		return fmt.Errorf("negative source account sequence")
	}
	transactionRow := model.Transaction{
		LedgerSequence:     sequence,
		TransactionIndex:   int64(transaction.Index),
		TransactionHash:    transactionHash,
		EnvelopeType:       int32(transaction.Envelope.Type),
		EnvelopeTypeString: transaction.Envelope.Type.String(),
		SourceAccount:      source,
		SourceAccountMuxed: sourceMuxed,
		FeeAccount:         feeAccount,
		FeeAccountMuxed:    feeAccountMuxed,
		AccountSequence:    accountSequence,
		MaxFee:             int64(transaction.Envelope.Fee()),
		FeeBumpMaxFee:      feeBumpMaxFee,
		IsFeeBump:          transaction.Envelope.IsFeeBump(),
		OperationCount:     int64(transaction.Envelope.OperationsCount()),
		MemoType:           transaction.Envelope.Memo().Type.String(),
		Memo:               memoValue(transaction.Envelope.Memo()),
		SignatureCount:     int64(signatureCount),
		Successful:         transaction.Result.Successful(),
		ClosedAtUnixMillis: closedAt,
	}
	if err := p.claim("transactions", 1); err != nil {
		return err
	}
	if err := p.outputs.Transactions.Write(transactionRow); err != nil {
		return err
	}

	if err := p.writeTransactionResult(transaction, transactionHash); err != nil {
		return err
	}
	if err := p.writeOperations(transaction, transactionHash); err != nil {
		return err
	}
	events, err := p.writeEvents(transaction, transactionHash)
	if err != nil {
		return err
	}
	changes, err := p.writeTransactionChanges(transaction, transactionHash)
	if err != nil {
		return err
	}
	return p.writeTransactionMeta(transaction, transactionHash, events, changes)
}

func (p *Processor) writeTransactionResult(transaction *ledgerTransaction, transactionHash string) error {
	result := transaction.Result.Result
	if result.FeeCharged < 0 {
		return fmt.Errorf("negative charged fee")
	}
	operationResults, _ := result.OperationResults()
	innerHash := ""
	if pair, hasInner := result.Result.GetInnerResultPair(); hasInner {
		innerHash = pair.TransactionHash.HexString()
	}
	row := model.TransactionResult{
		LedgerSequence:       int64(transaction.Ledger.LedgerSequence()),
		TransactionIndex:     int64(transaction.Index),
		TransactionHash:      transactionHash,
		Successful:           transaction.Result.Successful(),
		FeeCharged:           int64(result.FeeCharged),
		ResultCode:           int32(result.Result.Code),
		ResultCodeString:     result.Result.Code.String(),
		OperationResultCount: int64(len(operationResults)),
		InnerTransactionHash: innerHash,
	}
	if err := p.claim("transaction-results", 1); err != nil {
		return err
	}
	return p.outputs.TransactionResults.Write(row)
}

func (p *Processor) writeOperations(transaction *ledgerTransaction, transactionHash string) error {
	operations := transaction.Envelope.Operations()
	results, hasResults := transaction.Result.OperationResults()
	if transaction.Result.Successful() && (!hasResults || len(results) != len(operations)) {
		return fmt.Errorf("successful transaction has %d operations but %d operation results", len(operations), len(results))
	}
	if len(results) > len(operations) {
		return fmt.Errorf("transaction has more operation results than operations")
	}
	for index, operation := range operations {
		source := transaction.Envelope.SourceAccount()
		if operation.SourceAccount != nil {
			source = *operation.SourceAccount
		}
		sourceAccount, sourceMuxed, err := accountAddresses(source)
		if err != nil {
			return fmt.Errorf("operation %d source account: %w", index+1, err)
		}
		row := model.Operation{
			LedgerSequence:        int64(transaction.Ledger.LedgerSequence()),
			TransactionIndex:      int64(transaction.Index),
			OperationIndex:        int64(index + 1),
			TransactionHash:       transactionHash,
			SourceAccount:         sourceAccount,
			SourceAccountMuxed:    sourceMuxed,
			OperationType:         int32(operation.Body.Type),
			OperationTypeString:   operation.Body.Type.String(),
			SuccessfulTransaction: transaction.Result.Successful(),
		}
		if index < len(results) {
			result := results[index]
			row.HasResult = true
			row.ResultCode = int32(result.Code)
			row.ResultCodeString = result.Code.String()
		}
		if err := p.claim("operations", 1); err != nil {
			return err
		}
		if err := p.outputs.Operations.Write(row); err != nil {
			return err
		}
	}
	return nil
}

func (p *Processor) writeTransactionMeta(transaction *ledgerTransaction, transactionHash string, events eventCounts, changes changeCounts) error {
	row := model.TransactionMeta{
		LedgerSequence:          int64(transaction.Ledger.LedgerSequence()),
		TransactionIndex:        int64(transaction.Index),
		TransactionHash:         transactionHash,
		MetaVersion:             transaction.Meta.V,
		OperationMetaCount:      int64(operationMetaCount(transaction.Meta)),
		FeeChangeCount:          changes.fee,
		TransactionChangeCount:  changes.meta,
		PostApplyFeeChangeCount: changes.post,
		TransactionEventCount:   events.transaction,
		OperationEventCount:     events.operation,
		DiagnosticEventCount:    events.diagnostic,
		IsSoroban:               isSorobanEnvelope(transaction.Envelope),
	}
	if err := p.claim("transaction-meta", 1); err != nil {
		return err
	}
	return p.outputs.TransactionMeta.Write(row)
}

func accountAddresses(account xdr.MuxedAccount) (string, string, error) {
	accountID := account.ToAccountId()
	base, err := accountID.GetAddress()
	if err != nil {
		return "", "", err
	}
	if account.Type != xdr.CryptoKeyTypeKeyTypeMuxedEd25519 {
		return base, "", nil
	}
	muxed, err := account.GetAddress()
	if err != nil {
		return "", "", err
	}
	return base, muxed, nil
}

func operationMetaCount(meta xdr.TransactionMeta) int {
	switch meta.V {
	case 0:
		return len(meta.MustOperations())
	case 1:
		return len(meta.MustV1().Operations)
	case 2:
		return len(meta.MustV2().Operations)
	case 3:
		return len(meta.MustV3().Operations)
	case 4:
		return len(meta.MustV4().Operations)
	default:
		return 0
	}
}

func memoValue(memo xdr.Memo) string {
	switch memo.Type {
	case xdr.MemoTypeMemoNone:
		return ""
	case xdr.MemoTypeMemoText:
		return memo.MustText()
	case xdr.MemoTypeMemoId:
		return strconv.FormatUint(uint64(memo.MustId()), 10)
	case xdr.MemoTypeMemoHash:
		hash := memo.MustHash()
		return base64.StdEncoding.EncodeToString(hash[:])
	case xdr.MemoTypeMemoReturn:
		hash := memo.MustRetHash()
		return base64.StdEncoding.EncodeToString(hash[:])
	default:
		panic(fmt.Sprintf("unsupported memo type %d", memo.Type))
	}
}

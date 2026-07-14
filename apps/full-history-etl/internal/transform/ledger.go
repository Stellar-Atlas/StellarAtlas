package transform

import (
	"fmt"
	"math"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/stellar/go-stellar-sdk/xdr"
)

func makeLedger(meta xdr.LedgerCloseMeta) (model.Ledger, error) {
	headerEntry := meta.LedgerHeaderHistoryEntry()
	header := headerEntry.Header
	if int64(header.TotalCoins) < 0 {
		return model.Ledger{}, fmt.Errorf("negative total coin supply")
	}
	if int64(header.FeePool) < 0 {
		return model.Ledger{}, fmt.Errorf("negative fee pool")
	}
	closedAt, err := unixMillis(uint64(header.ScpValue.CloseTime))
	if err != nil {
		return model.Ledger{}, err
	}
	var successfulTransactions, successfulOperations, operations int64
	for i, envelope := range meta.TransactionEnvelopes() {
		operations += int64(envelope.OperationsCount())
		result := meta.TransactionResultPair(i).Result
		if !result.Successful() {
			continue
		}
		successfulTransactions++
		operationResults, ok := result.OperationResults()
		if !ok {
			return model.Ledger{}, fmt.Errorf("successful transaction %d has no operation results", i+1)
		}
		successfulOperations += int64(len(operationResults))
	}

	sorobanFee, hasSorobanFee, liveBytes, hasLiveBytes, evictedCount, err := ledgerCloseMetaExtras(meta)
	if err != nil {
		return model.Ledger{}, err
	}
	transactionCount := int64(meta.CountTransactions())
	return model.Ledger{
		LedgerSequence:                int64(header.LedgerSeq),
		LedgerCloseMetaVersion:        meta.V,
		LedgerHash:                    headerEntry.Hash.HexString(),
		PreviousLedgerHash:            header.PreviousLedgerHash.HexString(),
		TransactionSetHash:            header.ScpValue.TxSetHash.HexString(),
		TransactionResultSetHash:      header.TxSetResultHash.HexString(),
		BucketListHash:                header.BucketListHash.HexString(),
		ClosedAtUnixMillis:            closedAt,
		ProtocolVersion:               int64(header.LedgerVersion),
		TransactionCount:              transactionCount,
		SuccessfulTransactionCount:    successfulTransactions,
		FailedTransactionCount:        transactionCount - successfulTransactions,
		OperationCount:                operations,
		SuccessfulOperationCount:      successfulOperations,
		TotalCoins:                    int64(header.TotalCoins),
		FeePool:                       int64(header.FeePool),
		BaseFee:                       int64(header.BaseFee),
		BaseReserve:                   int64(header.BaseReserve),
		MaxTransactionSetSize:         int64(header.MaxTxSetSize),
		SorobanFeeWrite1KB:            sorobanFee,
		HasSorobanFeeWrite1KB:         hasSorobanFee,
		TotalLiveSorobanStateBytes:    liveBytes,
		HasTotalLiveSorobanStateBytes: hasLiveBytes,
		EvictedLedgerKeyCount:         evictedCount,
	}, nil
}

func ledgerCloseMetaExtras(meta xdr.LedgerCloseMeta) (int64, bool, int64, bool, int64, error) {
	var fee int64
	var hasFee bool
	var stateBytes uint64
	var hasState bool
	var evicted int
	switch meta.V {
	case 0:
		return 0, false, 0, false, 0, nil
	case 1:
		v1 := meta.MustV1()
		stateBytes, hasState, evicted = uint64(v1.TotalByteSizeOfLiveSorobanState), true, len(v1.EvictedKeys)
		if ext, ok := v1.Ext.GetV1(); ok {
			fee, hasFee = int64(ext.SorobanFeeWrite1Kb), true
		}
	case 2:
		v2 := meta.MustV2()
		stateBytes, hasState, evicted = uint64(v2.TotalByteSizeOfLiveSorobanState), true, len(v2.EvictedKeys)
		if ext, ok := v2.Ext.GetV1(); ok {
			fee, hasFee = int64(ext.SorobanFeeWrite1Kb), true
		}
	default:
		return 0, false, 0, false, 0, fmt.Errorf("unsupported LedgerCloseMeta version %d", meta.V)
	}
	if stateBytes > math.MaxInt64 {
		return 0, false, 0, false, 0, fmt.Errorf("live Soroban state byte count overflows int64")
	}
	return fee, hasFee, int64(stateBytes), hasState, int64(evicted), nil
}

func unixMillis(seconds uint64) (int64, error) {
	if seconds > math.MaxInt64/1000 {
		return 0, fmt.Errorf("ledger close time overflows Unix milliseconds")
	}
	return int64(seconds) * 1000, nil
}

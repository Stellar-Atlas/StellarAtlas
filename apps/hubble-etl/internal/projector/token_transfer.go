package projector

import (
	"fmt"
	"strconv"

	"github.com/guregu/null"
	"github.com/stellar/go-stellar-sdk/processors/token_transfer"
	"github.com/stellar/go-stellar-sdk/strkey"
	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/internal/toid"
	"github.com/stellar/stellar-etl/v2/internal/transform"
)

func (p *Projector) transformTokenTransfers(
	meta xdr.LedgerCloseMeta,
) ([]transform.TokenTransferOutput, error) {
	if meta.LedgerHeaderHistoryEntry().Header.LedgerVersion >= 23 {
		return transform.TransformTokenTransfer(meta, p.networkPassphrase)
	}
	processor := token_transfer.NewEventsProcessor(p.networkPassphrase)
	events, err := processor.EventsFromLedger(meta)
	if err != nil {
		return nil, err
	}
	if err := token_transfer.VerifyEvents(
		meta,
		p.networkPassphrase,
		false,
	); err != nil {
		return nil, err
	}
	rows := make([]transform.TokenTransferOutput, 0, len(events))
	for _, event := range events {
		row, err := legacyTokenTransfer(event, meta)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// This mirrors stellar-etl's exported row mapping while its public helper only
// accepts protocol-23 unified-event metadata.
func legacyTokenTransfer(
	event *token_transfer.TokenTransferEvent,
	meta xdr.LedgerCloseMeta,
) (transform.TokenTransferOutput, error) {
	var from, to null.String
	var amount string
	switch typed := event.Event.(type) {
	case *token_transfer.TokenTransferEvent_Transfer:
		from = null.StringFrom(typed.Transfer.From)
		to = null.StringFrom(typed.Transfer.To)
		amount = typed.Transfer.Amount
	case *token_transfer.TokenTransferEvent_Mint:
		to = null.StringFrom(typed.Mint.To)
		amount = typed.Mint.Amount
	case *token_transfer.TokenTransferEvent_Burn:
		from = null.StringFrom(typed.Burn.From)
		amount = typed.Burn.Amount
	case *token_transfer.TokenTransferEvent_Clawback:
		from = null.StringFrom(typed.Clawback.From)
		amount = typed.Clawback.Amount
	case *token_transfer.TokenTransferEvent_Fee:
		from = null.StringFrom(typed.Fee.From)
		amount = typed.Fee.Amount
	default:
		return transform.TokenTransferOutput{}, fmt.Errorf(
			"unknown token-transfer event type in ledger %d",
			event.Meta.LedgerSequence,
		)
	}
	amountFloat, _ := strconv.ParseFloat(amount, 64)
	amountFloat *= 0.0000001
	eventMeta := event.GetMeta()
	transactionID := toid.New(
		int32(eventMeta.LedgerSequence),
		int32(eventMeta.TransactionIndex),
		0,
	).ToInt64()
	var operationID null.Int
	if eventMeta.OperationIndex != nil {
		operationID = null.IntFrom(toid.New(
			int32(eventMeta.LedgerSequence),
			int32(eventMeta.TransactionIndex),
			int32(*eventMeta.OperationIndex),
		).ToInt64())
	}
	asset, assetType, assetCode, assetIssuer := legacyEventAsset(event)
	var toMuxed, toMuxedID null.String
	if eventMeta.ToMuxedInfo != nil {
		muxed := strkey.MuxedAccount{}
		muxed.SetAccountID(to.String)
		muxed.SetID(eventMeta.ToMuxedInfo.GetId())
		address, err := muxed.Address()
		if err != nil {
			return transform.TokenTransferOutput{}, err
		}
		toMuxed = null.StringFrom(address)
		toMuxedID = null.StringFrom(
			strconv.FormatUint(eventMeta.ToMuxedInfo.GetId(), 10),
		)
	}
	return transform.TokenTransferOutput{
		TransactionHash: eventMeta.TxHash,
		TransactionID:   transactionID,
		OperationID:     operationID,
		EventTopic:      event.GetEventType(),
		From:            from,
		To:              to,
		Asset:           asset,
		AssetType:       assetType,
		AssetCode:       assetCode,
		AssetIssuer:     assetIssuer,
		Amount:          amountFloat,
		AmountRaw:       amount,
		ContractID:      eventMeta.ContractAddress,
		LedgerSequence:  eventMeta.LedgerSequence,
		ClosedAt:        meta.ClosedAt(),
		ToMuxed:         toMuxed,
		ToMuxedID:       toMuxedID,
	}, nil
}

func legacyEventAsset(
	event *token_transfer.TokenTransferEvent,
) (asset, assetType string, code, issuer null.String) {
	if event.GetAsset().GetNative() {
		return "native", "native", code, issuer
	}
	issued := event.GetAsset().GetIssuedAsset()
	if issued == nil {
		return "", "", code, issuer
	}
	assetType = "credit_alphanum4"
	if len(issued.AssetCode) > 4 {
		assetType = "credit_alphanum12"
	}
	code = null.StringFrom(issued.AssetCode)
	issuer = null.StringFrom(issued.Issuer)
	asset = fmt.Sprintf("%s:%s:%s", assetType, issued.AssetCode, issued.Issuer)
	return asset, assetType, code, issuer
}

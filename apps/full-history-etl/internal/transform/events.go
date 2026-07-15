package transform

import (
	"fmt"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/stellar/go-stellar-sdk/strkey"
	"github.com/stellar/go-stellar-sdk/xdr"
)

func (p *Processor) writeEvents(transaction *ledgerTransaction, transactionHash string) (eventCounts, error) {
	var counts eventCounts
	events, err := eventsForTransaction(transaction)
	if err != nil {
		return counts, fmt.Errorf("extract contract events: %w", err)
	}
	eventIndex := int64(0)
	for _, transactionEvent := range events.transaction {
		eventIndex++
		stage := int32(transactionEvent.Stage)
		if err := p.writeEvent(transaction, transactionHash, eventIndex, "transaction", 0, false, stage, transactionEvent.Stage.String(), true, true, transactionEvent.Event); err != nil {
			return counts, err
		}
		counts.transaction++
	}
	for operationIndex, operationEvents := range events.operation {
		for _, event := range operationEvents {
			eventIndex++
			if err := p.writeEvent(transaction, transactionHash, eventIndex, "operation", int64(operationIndex+1), true, 0, "", false, true, event); err != nil {
				return counts, err
			}
			counts.operation++
		}
	}
	for _, diagnosticEvent := range events.diagnostic {
		eventIndex++
		if err := p.writeEvent(transaction, transactionHash, eventIndex, "diagnostic", 0, false, 0, "", false, diagnosticEvent.InSuccessfulContractCall, diagnosticEvent.Event); err != nil {
			return counts, err
		}
		counts.diagnostic++
	}
	return counts, nil
}

func (p *Processor) writeEvent(
	transaction *ledgerTransaction,
	transactionHash string,
	eventIndex int64,
	scope string,
	operationIndex int64,
	hasOperationIndex bool,
	stage int32,
	stageString string,
	hasStage bool,
	inSuccessfulContractCall bool,
	event xdr.ContractEvent,
) error {
	body, ok := event.Body.GetV0()
	if !ok {
		return fmt.Errorf("contract event %d has unsupported body version %d", eventIndex, event.Body.V)
	}
	topicsXDR, err := xdr.ScVec(body.Topics).MarshalBinary()
	if err != nil {
		return fmt.Errorf("encode contract event %d topics: %w", eventIndex, err)
	}
	dataXDR, err := body.Data.MarshalBinary()
	if err != nil {
		return fmt.Errorf("encode contract event %d data: %w", eventIndex, err)
	}
	contractID := ""
	hasContractID := event.ContractId != nil
	if event.ContractId != nil {
		raw := *event.ContractId
		encodedContractID, err := strkey.Encode(strkey.VersionByteContract, raw[:])
		if err != nil {
			return fmt.Errorf("encode contract ID: %w", err)
		}
		contractID = encodedContractID
	}
	row := model.ContractEvent{
		LedgerSequence:           int64(transaction.Ledger.LedgerSequence()),
		TransactionIndex:         int64(transaction.Index),
		EventIndex:               eventIndex,
		TransactionHash:          transactionHash,
		Scope:                    scope,
		OperationIndex:           operationIndex,
		HasOperationIndex:        hasOperationIndex,
		Stage:                    stage,
		StageString:              stageString,
		HasStage:                 hasStage,
		InSuccessfulContractCall: inSuccessfulContractCall,
		ExtensionVersion:         event.Ext.V,
		ContractID:               contractID,
		HasContractID:            hasContractID,
		EventType:                int32(event.Type),
		EventTypeString:          event.Type.String(),
		BodyVersion:              event.Body.V,
		TopicCount:               int64(len(body.Topics)),
		TopicsXDR:                string(topicsXDR),
		DataType:                 int32(body.Data.Type),
		DataTypeString:           body.Data.Type.String(),
		DataXDR:                  string(dataXDR),
	}
	if err := p.claim("contract-events", 1); err != nil {
		return err
	}
	return p.outputs.ContractEvents.Write(row)
}

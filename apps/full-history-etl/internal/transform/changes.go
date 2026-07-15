package transform

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/stellar/go-stellar-sdk/xdr"
)

type changeCounts struct {
	fee  int64
	meta int64
	post int64
}

type changeContext struct {
	reason             string
	ledgerSequence     int64
	closedAtUnixMillis int64
	operationIndex     int64
	hasOperationIndex  bool
	upgradeIndex       int64
	hasUpgradeIndex    bool
}

func (p *Processor) writeTransactionChanges(transaction *ledgerTransaction, transactionHash string) (changeCounts, error) {
	var counts changeCounts
	changeIndex := int64(0)
	feeCount, err := p.writeChangeGroup(transaction, transactionHash, &changeIndex, transaction.FeeChanges, changeContext{reason: "fee"})
	if err != nil {
		return counts, err
	}
	counts.fee = feeCount

	writeMeta := func(changes xdr.LedgerEntryChanges, context changeContext) error {
		count, groupErr := p.writeChangeGroup(transaction, transactionHash, &changeIndex, changes, context)
		counts.meta += count
		return groupErr
	}
	meta := transaction.Meta
	switch meta.V {
	case 0:
		for index, operation := range meta.MustOperations() {
			if err := writeMeta(operation.Changes, operationContext(index)); err != nil {
				return counts, err
			}
		}
	case 1:
		v1 := meta.MustV1()
		if err := writeMeta(v1.TxChanges, changeContext{reason: "transaction"}); err != nil {
			return counts, err
		}
		for index, operation := range v1.Operations {
			if err := writeMeta(operation.Changes, operationContext(index)); err != nil {
				return counts, err
			}
		}
	case 2:
		v2 := meta.MustV2()
		if err := p.writeMetaV2Groups(v2.TxChangesBefore, v2.Operations, v2.TxChangesAfter, writeMeta); err != nil {
			return counts, err
		}
	case 3:
		v3 := meta.MustV3()
		if err := p.writeMetaV2Groups(v3.TxChangesBefore, v3.Operations, v3.TxChangesAfter, writeMeta); err != nil {
			return counts, err
		}
	case 4:
		v4 := meta.MustV4()
		if err := writeMeta(v4.TxChangesBefore, changeContext{reason: "transaction"}); err != nil {
			return counts, err
		}
		for index, operation := range v4.Operations {
			if err := writeMeta(operation.Changes, operationContext(index)); err != nil {
				return counts, err
			}
		}
		if err := writeMeta(v4.TxChangesAfter, changeContext{reason: "transaction"}); err != nil {
			return counts, err
		}
	default:
		return counts, fmt.Errorf("unsupported transaction meta version %d", meta.V)
	}

	postCount, err := p.writeChangeGroup(transaction, transactionHash, &changeIndex, transaction.PostApplyFeeChanges, changeContext{reason: "fee_refund"})
	counts.post = postCount
	return counts, err
}

func (p *Processor) writeMetaV2Groups(
	before xdr.LedgerEntryChanges,
	operations []xdr.OperationMeta,
	after xdr.LedgerEntryChanges,
	write func(xdr.LedgerEntryChanges, changeContext) error,
) error {
	if err := write(before, changeContext{reason: "transaction"}); err != nil {
		return err
	}
	for index, operation := range operations {
		if err := write(operation.Changes, operationContext(index)); err != nil {
			return err
		}
	}
	return write(after, changeContext{reason: "transaction"})
}

func (p *Processor) writeUpgradeChanges(meta xdr.LedgerCloseMeta) error {
	closedAt, err := unixMillis(uint64(meta.LedgerCloseTime()))
	if err != nil {
		return err
	}
	changeIndex := int64(0)
	for index, upgrade := range meta.UpgradesProcessing() {
		_, err = p.writeChangeGroup(nil, "", &changeIndex, upgrade.Changes, changeContext{
			reason:             "upgrade",
			ledgerSequence:     int64(meta.LedgerSequence()),
			closedAtUnixMillis: closedAt,
			upgradeIndex:       int64(index + 1),
			hasUpgradeIndex:    true,
		})
		if err != nil {
			return fmt.Errorf("upgrade %d changes: %w", index+1, err)
		}
	}
	return nil
}

func (p *Processor) writeChangeGroup(
	transaction *ledgerTransaction,
	transactionHash string,
	changeIndex *int64,
	raw xdr.LedgerEntryChanges,
	context changeContext,
) (int64, error) {
	changes, err := normalizeChanges(raw)
	if err != nil {
		return 0, err
	}
	sequence := context.ledgerSequence
	transactionIndex := int64(0)
	closedAtUnixMillis := context.closedAtUnixMillis
	if transaction != nil {
		sequence = int64(transaction.Ledger.LedgerSequence())
		transactionIndex = int64(transaction.Index)
		closedAtUnixMillis, err = unixMillis(uint64(transaction.Ledger.LedgerCloseTime()))
		if err != nil {
			return 0, err
		}
	} else if sequence == 0 {
		return 0, fmt.Errorf("upgrade change is missing ledger sequence context")
	}
	for _, change := range changes {
		*changeIndex = *changeIndex + 1
		key, err := change.ledgerKey()
		if err != nil {
			return 0, fmt.Errorf("derive ledger key: %w", err)
		}
		keyBytes, err := key.MarshalBinary()
		if err != nil {
			return 0, fmt.Errorf("encode ledger key: %w", err)
		}
		keyHash := sha256.Sum256(keyBytes)
		preEntryBytes, err := marshalLedgerEntry(change.Pre)
		if err != nil {
			return 0, fmt.Errorf("encode pre-change ledger entry: %w", err)
		}
		postEntryBytes, err := marshalLedgerEntry(change.Post)
		if err != nil {
			return 0, fmt.Errorf("encode post-change ledger entry: %w", err)
		}
		row := model.LedgerEntryChange{
			LedgerSequence:    sequence,
			TransactionIndex:  transactionIndex,
			ChangeIndex:       *changeIndex,
			TransactionHash:   transactionHash,
			Reason:            context.reason,
			OperationIndex:    context.operationIndex,
			HasOperationIndex: context.hasOperationIndex,
			UpgradeIndex:      context.upgradeIndex,
			HasUpgradeIndex:   context.hasUpgradeIndex,
			EntryType:         int32(change.Type),
			EntryTypeString:   change.Type.String(),
			ChangeType:        int32(change.ChangeType),
			ChangeTypeString:  change.ChangeType.String(),
			LedgerKeySHA256:   hex.EncodeToString(keyHash[:]),
			LedgerKeyXDR:      string(keyBytes),
			HasPreEntry:       change.Pre != nil,
			PreEntryXDR:       string(preEntryBytes),
			HasPostEntry:      change.Post != nil,
			PostEntryXDR:      string(postEntryBytes),
		}
		if err := p.claim("ledger-entry-changes", 1); err != nil {
			return 0, err
		}
		if err := p.outputs.LedgerEntryChanges.Write(row); err != nil {
			return 0, err
		}
		if err := p.writeStateChangeProjection(change, row, closedAtUnixMillis); err != nil {
			return 0, err
		}
	}
	return int64(len(changes)), nil
}

func marshalLedgerEntry(entry *xdr.LedgerEntry) ([]byte, error) {
	if entry == nil {
		return []byte{}, nil
	}
	return entry.MarshalBinary()
}

func operationContext(index int) changeContext {
	return changeContext{reason: "operation", operationIndex: int64(index + 1), hasOperationIndex: true}
}

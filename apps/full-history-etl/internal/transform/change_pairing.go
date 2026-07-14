package transform

// Change pairing is adapted from go-stellar-sdk ingest/change.go under the
// Apache License, Version 2.0. It validates state/update and state/remove pairs
// instead of retaining raw, unpaired change arms.

import (
	"bytes"
	"fmt"

	"github.com/stellar/go-stellar-sdk/xdr"
)

type normalizedChange struct {
	Type       xdr.LedgerEntryType
	ChangeType xdr.LedgerEntryChangeType
	Pre        *xdr.LedgerEntry
	Post       *xdr.LedgerEntry
}

func normalizeChanges(raw xdr.LedgerEntryChanges) ([]normalizedChange, error) {
	changes := make([]normalizedChange, 0, len(raw))
	for index, change := range raw {
		switch change.Type {
		case xdr.LedgerEntryChangeTypeLedgerEntryState:
			continue
		case xdr.LedgerEntryChangeTypeLedgerEntryCreated:
			created := change.MustCreated()
			changes = append(changes, normalizedChange{Type: created.Data.Type, ChangeType: change.Type, Post: &created})
		case xdr.LedgerEntryChangeTypeLedgerEntryRestored:
			restored := change.MustRestored()
			changes = append(changes, normalizedChange{Type: restored.Data.Type, ChangeType: change.Type, Post: &restored})
		case xdr.LedgerEntryChangeTypeLedgerEntryUpdated, xdr.LedgerEntryChangeTypeLedgerEntryRemoved:
			if index == 0 {
				return nil, fmt.Errorf("%s change has no preceding state", change.Type.String())
			}
			pre, ok := raw[index-1].GetState()
			if !ok {
				pre, ok = raw[index-1].GetRestored()
			}
			if !ok {
				return nil, fmt.Errorf("%s change is not preceded by state or restored", change.Type.String())
			}
			normalized := normalizedChange{Type: pre.Data.Type, ChangeType: change.Type, Pre: &pre}
			if change.Type == xdr.LedgerEntryChangeTypeLedgerEntryUpdated {
				post := change.MustUpdated()
				if err := validateSameLedgerKey(pre, post); err != nil {
					return nil, err
				}
				normalized.Post = &post
			} else {
				removed := change.MustRemoved()
				preKey, err := pre.LedgerKey()
				if err != nil {
					return nil, err
				}
				preBytes, err := preKey.MarshalBinary()
				if err != nil {
					return nil, err
				}
				removedBytes, err := removed.MarshalBinary()
				if err != nil {
					return nil, err
				}
				if !bytes.Equal(preBytes, removedBytes) {
					return nil, fmt.Errorf("removed ledger key does not match preceding state")
				}
			}
			changes = append(changes, normalized)
		default:
			return nil, fmt.Errorf("unsupported ledger entry change type %d", change.Type)
		}
	}
	return changes, nil
}

func (change normalizedChange) ledgerKey() (xdr.LedgerKey, error) {
	if change.Pre != nil {
		return change.Pre.LedgerKey()
	}
	if change.Post == nil {
		return xdr.LedgerKey{}, fmt.Errorf("normalized change has neither pre nor post entry")
	}
	return change.Post.LedgerKey()
}

func validateSameLedgerKey(pre, post xdr.LedgerEntry) error {
	preKey, err := pre.LedgerKey()
	if err != nil {
		return err
	}
	postKey, err := post.LedgerKey()
	if err != nil {
		return err
	}
	preBytes, err := preKey.MarshalBinary()
	if err != nil {
		return err
	}
	postBytes, err := postKey.MarshalBinary()
	if err != nil {
		return err
	}
	if !bytes.Equal(preBytes, postBytes) {
		return fmt.Errorf("updated ledger key does not match preceding state")
	}
	return nil
}

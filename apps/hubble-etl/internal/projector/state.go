package projector

import (
	"context"
	"fmt"
	"io"

	"github.com/stellar/go-stellar-sdk/ingest"
	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/internal/utils"
)

func (p *Projector) projectStateChanges(
	ctx context.Context,
	meta xdr.LedgerCloseMeta,
) error {
	sequence := meta.LedgerSequence()
	rawReader, err := ingest.NewLedgerChangeReaderFromLedgerCloseMeta(
		p.networkPassphrase,
		meta,
	)
	if err != nil {
		return fmt.Errorf("read state changes at ledger %d: %w", sequence, err)
	}
	reader := ingest.NewCompactingChangeReader(
		rawReader,
		ingest.ChangeCompactorConfig{SuppressRemoveAfterRestoreChange: false},
	)
	defer reader.Close()
	header := meta.LedgerHeaderHistoryEntry()
	contractDataTransform := transform.NewTransformContractDataStruct(
		transform.AssetFromContractData,
		transform.ContractBalanceFromContractData,
	)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		change, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("compact state changes at ledger %d: %w", sequence, err)
		}
		if change.ChangeType == xdr.LedgerEntryChangeTypeLedgerEntryRestored {
			restored, err := transform.TransformRestoredKey(change, header)
			if err != nil {
				return fmt.Errorf("transform restored key at ledger %d: %w", sequence, err)
			}
			if err := p.emit(ctx, "restored_key", sequence, restored); err != nil {
				return err
			}
		}
		switch change.Type {
		case xdr.LedgerEntryTypeAccount:
			if err := p.projectAccountChange(ctx, sequence, header, change); err != nil {
				return err
			}
		case xdr.LedgerEntryTypeClaimableBalance:
			row, err := transform.TransformClaimableBalance(change, header)
			if err != nil {
				return stateError(sequence, "claimable balance", err)
			}
			if err := p.emit(ctx, "claimable_balances", sequence, row); err != nil {
				return err
			}
		case xdr.LedgerEntryTypeOffer:
			row, err := transform.TransformOffer(change, header)
			if err != nil {
				return stateError(sequence, "offer", err)
			}
			if err := p.emit(ctx, "offers", sequence, row); err != nil {
				return err
			}
		case xdr.LedgerEntryTypeTrustline:
			row, err := transform.TransformTrustline(change, header)
			if err != nil {
				return stateError(sequence, "trustline", err)
			}
			if err := p.emit(ctx, "trustlines", sequence, row); err != nil {
				return err
			}
		case xdr.LedgerEntryTypeLiquidityPool:
			row, err := transform.TransformPool(change, header)
			if err != nil {
				return stateError(sequence, "liquidity pool", err)
			}
			if err := p.emit(ctx, "liquidity_pools", sequence, row); err != nil {
				return err
			}
		case xdr.LedgerEntryTypeContractData:
			row, err, emit := contractDataTransform.TransformContractData(
				change,
				p.networkPassphrase,
				header,
			)
			if err != nil {
				return stateError(sequence, "contract data", err)
			}
			if emit {
				if err := p.emit(ctx, "contract_data", sequence, row); err != nil {
					return err
				}
			}
		case xdr.LedgerEntryTypeContractCode:
			row, err := transform.TransformContractCode(change, header)
			if err != nil {
				return stateError(sequence, "contract code", err)
			}
			if err := p.emit(ctx, "contract_code", sequence, row); err != nil {
				return err
			}
		case xdr.LedgerEntryTypeConfigSetting:
			row, err := transform.TransformConfigSetting(change, header)
			if err != nil {
				return stateError(sequence, "config setting", err)
			}
			if err := p.emit(ctx, "config_settings", sequence, row); err != nil {
				return err
			}
		case xdr.LedgerEntryTypeTtl:
			row, err := transform.TransformTtl(change, header)
			if err != nil {
				return stateError(sequence, "ttl", err)
			}
			if err := p.emit(ctx, "ttl", sequence, row); err != nil {
				return err
			}
		case xdr.LedgerEntryTypeData:
			// Hubble intentionally does not expose classic account-data entries.
		default:
			return fmt.Errorf(
				"ledger %d has unsupported state type %s",
				sequence,
				change.Type,
			)
		}
	}
	return nil
}

func (p *Projector) projectAccountChange(
	ctx context.Context,
	sequence uint32,
	header xdr.LedgerHeaderHistoryEntry,
	change ingest.Change,
) error {
	changed, err := change.AccountChangedExceptSigners()
	if err != nil {
		return stateError(sequence, "account comparison", err)
	}
	if changed {
		account, err := transform.TransformAccount(change, header)
		if err != nil {
			return stateError(sequence, "account", err)
		}
		if err := p.emit(ctx, "accounts", sequence, account); err != nil {
			return err
		}
	}
	if !utils.AccountSignersChanged(change) {
		return nil
	}
	signers, err := transform.TransformSigners(change, header)
	if err != nil {
		return stateError(sequence, "account signer", err)
	}
	for _, signer := range signers {
		if err := p.emit(ctx, "account_signers", sequence, signer); err != nil {
			return err
		}
	}
	return nil
}

func stateError(sequence uint32, kind string, err error) error {
	return fmt.Errorf("transform %s at ledger %d: %w", kind, sequence, err)
}

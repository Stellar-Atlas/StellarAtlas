package transform

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/stellar/go-stellar-sdk/xdr"
)

func (p *Processor) writeStateChangeProjection(
	change normalizedChange,
	provenance model.LedgerEntryChange,
	closedAtUnixMillis int64,
) error {
	entry, deleted, err := effectiveStateChangeEntry(change)
	if err != nil {
		return err
	}
	stateEntryXDR, err := entry.MarshalBinary()
	if err != nil {
		return fmt.Errorf("encode effective state entry: %w", err)
	}
	switch change.Type {
	case xdr.LedgerEntryTypeAccount:
		row, err := makeAccountStateChange(entry, provenance, closedAtUnixMillis, deleted, stateEntryXDR)
		if err != nil {
			return err
		}
		if err := p.claim("account-state-changes", 1); err != nil {
			return err
		}
		return p.outputs.AccountStateChanges.Write(row)
	case xdr.LedgerEntryTypeTrustline:
		row, err := makeTrustlineStateChange(entry, provenance, closedAtUnixMillis, deleted, stateEntryXDR)
		if err != nil {
			return err
		}
		if err := p.claim("trustline-state-changes", 1); err != nil {
			return err
		}
		return p.outputs.TrustlineStateChanges.Write(row)
	default:
		return nil
	}
}

func effectiveStateChangeEntry(change normalizedChange) (xdr.LedgerEntry, bool, error) {
	if change.Post != nil {
		return *change.Post, false, nil
	}
	if change.Pre != nil && change.ChangeType == xdr.LedgerEntryChangeTypeLedgerEntryRemoved {
		return *change.Pre, true, nil
	}
	return xdr.LedgerEntry{}, false, fmt.Errorf("normalized %s change has no effective ledger entry", change.ChangeType.String())
}

func makeAccountStateChange(
	entry xdr.LedgerEntry,
	provenance model.LedgerEntryChange,
	closedAtUnixMillis int64,
	deleted bool,
	stateEntryXDR []byte,
) (model.AccountStateChange, error) {
	account, ok := entry.Data.GetAccount()
	if !ok {
		return model.AccountStateChange{}, fmt.Errorf("account state change contains %s entry", entry.Data.Type.String())
	}
	accountID, err := account.AccountId.GetAddress()
	if err != nil {
		return model.AccountStateChange{}, fmt.Errorf("encode account ID: %w", err)
	}
	sponsor, hasSponsor, err := ledgerEntrySponsor(entry)
	if err != nil {
		return model.AccountStateChange{}, err
	}
	extension := accountExtensionValues(account)
	inflationDestination, hasInflationDestination, err := optionalAccountAddress(account.InflationDest)
	if err != nil {
		return model.AccountStateChange{}, fmt.Errorf("encode inflation destination: %w", err)
	}
	signerKeys, signerWeights, signerSponsors, err := accountSignerValues(account.Signers, extension.signerSponsors)
	if err != nil {
		return model.AccountStateChange{}, err
	}
	return model.AccountStateChange{
		LedgerSequence:       provenance.LedgerSequence,
		TransactionIndex:     provenance.TransactionIndex,
		ChangeIndex:          provenance.ChangeIndex,
		TransactionHash:      provenance.TransactionHash,
		Reason:               provenance.Reason,
		OperationIndex:       provenance.OperationIndex,
		HasOperationIndex:    provenance.HasOperationIndex,
		UpgradeIndex:         provenance.UpgradeIndex,
		HasUpgradeIndex:      provenance.HasUpgradeIndex,
		ChangeType:           provenance.ChangeType,
		ChangeTypeString:     provenance.ChangeTypeString,
		Deleted:              deleted,
		LedgerKeySHA256:      provenance.LedgerKeySHA256,
		StateEntryXDR:        string(stateEntryXDR),
		LastModifiedLedger:   int64(entry.LastModifiedLedgerSeq),
		Sponsor:              sponsor,
		HasSponsor:           hasSponsor,
		ClosedAtUnixMillis:   closedAtUnixMillis,
		AccountID:            accountID,
		Balance:              int64(account.Balance),
		BuyingLiabilities:    extension.buyingLiabilities,
		SellingLiabilities:   extension.sellingLiabilities,
		SequenceNumber:       int64(account.SeqNum),
		SequenceLedger:       extension.sequenceLedger,
		SequenceTime:         extension.sequenceTime,
		HasSequenceMetadata:  extension.hasSequenceMetadata,
		SubentryCount:        int64(account.NumSubEntries),
		Flags:                int64(account.Flags),
		HomeDomain:           string(account.HomeDomain),
		InflationDestination: inflationDestination,
		HasInflationDest:     hasInflationDestination,
		MasterWeight:         int32(account.Thresholds[xdr.ThresholdIndexesThresholdMasterWeight]),
		LowThreshold:         int32(account.Thresholds[xdr.ThresholdIndexesThresholdLow]),
		MediumThreshold:      int32(account.Thresholds[xdr.ThresholdIndexesThresholdMed]),
		HighThreshold:        int32(account.Thresholds[xdr.ThresholdIndexesThresholdHigh]),
		SponsoredEntryCount:  extension.numSponsored,
		SponsoringEntryCount: extension.numSponsoring,
		SignerCount:          int64(len(account.Signers)),
		SignerKeys:           signerKeys,
		SignerWeights:        signerWeights,
		SignerSponsors:       signerSponsors,
	}, nil
}

type accountExtensionProjection struct {
	buyingLiabilities, sellingLiabilities int64
	numSponsored, numSponsoring           int64
	sequenceLedger, sequenceTime          int64
	hasSequenceMetadata                   bool
	signerSponsors                        []xdr.SponsorshipDescriptor
}

func accountExtensionValues(account xdr.AccountEntry) accountExtensionProjection {
	var projection accountExtensionProjection
	v1, ok := account.Ext.GetV1()
	if !ok {
		return projection
	}
	projection.buyingLiabilities = int64(v1.Liabilities.Buying)
	projection.sellingLiabilities = int64(v1.Liabilities.Selling)
	v2, ok := v1.Ext.GetV2()
	if !ok {
		return projection
	}
	projection.numSponsored = int64(v2.NumSponsored)
	projection.numSponsoring = int64(v2.NumSponsoring)
	projection.signerSponsors = v2.SignerSponsoringIDs
	if v3, ok := v2.Ext.GetV3(); ok {
		projection.sequenceLedger = int64(v3.SeqLedger)
		projection.sequenceTime = int64(v3.SeqTime)
		projection.hasSequenceMetadata = true
	}
	return projection
}

func makeTrustlineStateChange(
	entry xdr.LedgerEntry,
	provenance model.LedgerEntryChange,
	closedAtUnixMillis int64,
	deleted bool,
	stateEntryXDR []byte,
) (model.TrustlineStateChange, error) {
	trustline, ok := entry.Data.GetTrustLine()
	if !ok {
		return model.TrustlineStateChange{}, fmt.Errorf("trustline state change contains %s entry", entry.Data.Type.String())
	}
	accountID, err := trustline.AccountId.GetAddress()
	if err != nil {
		return model.TrustlineStateChange{}, fmt.Errorf("encode trustline account ID: %w", err)
	}
	assetCode, assetIssuer, poolID, err := trustlineAssetIdentity(trustline.Asset)
	if err != nil {
		return model.TrustlineStateChange{}, err
	}
	sponsor, hasSponsor, err := ledgerEntrySponsor(entry)
	if err != nil {
		return model.TrustlineStateChange{}, err
	}
	buyingLiabilities, sellingLiabilities, poolUseCount := trustlineExtensionValues(trustline)
	return model.TrustlineStateChange{
		LedgerSequence:        provenance.LedgerSequence,
		TransactionIndex:      provenance.TransactionIndex,
		ChangeIndex:           provenance.ChangeIndex,
		TransactionHash:       provenance.TransactionHash,
		Reason:                provenance.Reason,
		OperationIndex:        provenance.OperationIndex,
		HasOperationIndex:     provenance.HasOperationIndex,
		UpgradeIndex:          provenance.UpgradeIndex,
		HasUpgradeIndex:       provenance.HasUpgradeIndex,
		ChangeType:            provenance.ChangeType,
		ChangeTypeString:      provenance.ChangeTypeString,
		Deleted:               deleted,
		LedgerKeySHA256:       provenance.LedgerKeySHA256,
		StateEntryXDR:         string(stateEntryXDR),
		LastModifiedLedger:    int64(entry.LastModifiedLedgerSeq),
		Sponsor:               sponsor,
		HasSponsor:            hasSponsor,
		ClosedAtUnixMillis:    closedAtUnixMillis,
		AccountID:             accountID,
		AssetType:             int32(trustline.Asset.Type),
		AssetTypeString:       trustline.Asset.Type.String(),
		AssetCode:             assetCode,
		AssetIssuer:           assetIssuer,
		LiquidityPoolID:       poolID,
		Balance:               int64(trustline.Balance),
		Limit:                 int64(trustline.Limit),
		BuyingLiabilities:     buyingLiabilities,
		SellingLiabilities:    sellingLiabilities,
		LiquidityPoolUseCount: poolUseCount,
		Flags:                 int64(trustline.Flags),
	}, nil
}

func trustlineExtensionValues(trustline xdr.TrustLineEntry) (buying, selling int64, poolUseCount int32) {
	v1, ok := trustline.Ext.GetV1()
	if !ok {
		return 0, 0, 0
	}
	if v2, ok := v1.Ext.GetV2(); ok {
		poolUseCount = int32(v2.LiquidityPoolUseCount)
	}
	return int64(v1.Liabilities.Buying), int64(v1.Liabilities.Selling), poolUseCount
}

func optionalAccountAddress(account *xdr.AccountId) (string, bool, error) {
	if account == nil {
		return "", false, nil
	}
	address, err := account.GetAddress()
	return address, true, err
}

func accountSignerValues(
	signers []xdr.Signer,
	sponsors []xdr.SponsorshipDescriptor,
) ([]string, []int32, []string, error) {
	if len(signers) == 0 {
		if len(sponsors) != 0 {
			return nil, nil, nil, fmt.Errorf("signer sponsorship count does not match signer count")
		}
		return nil, nil, nil, nil
	}
	if len(sponsors) != 0 && len(sponsors) != len(signers) {
		return nil, nil, nil, fmt.Errorf("signer sponsorship count does not match signer count")
	}
	keys := make([]string, len(signers))
	weights := make([]int32, len(signers))
	sponsorAddresses := make([]string, len(signers))
	for index, signer := range signers {
		address, err := signer.Key.GetAddress()
		if err != nil {
			return nil, nil, nil, fmt.Errorf("encode signer %d key: %w", index, err)
		}
		keys[index] = address
		weights[index] = int32(signer.Weight)
		if len(sponsors) == 0 || sponsors[index] == nil {
			continue
		}
		sponsor, err := sponsors[index].GetAddress()
		if err != nil {
			return nil, nil, nil, fmt.Errorf("encode signer %d sponsor: %w", index, err)
		}
		sponsorAddresses[index] = sponsor
	}
	return keys, weights, sponsorAddresses, nil
}

func trustlineAssetIdentity(asset xdr.TrustLineAsset) (code, issuer, poolID string, err error) {
	switch asset.Type {
	case xdr.AssetTypeAssetTypeNative:
		return "", "", "", nil
	case xdr.AssetTypeAssetTypeCreditAlphanum4:
		credit := asset.MustAlphaNum4()
		issuer, err = credit.Issuer.GetAddress()
		code = strings.TrimRight(string(credit.AssetCode[:]), "\x00")
	case xdr.AssetTypeAssetTypeCreditAlphanum12:
		credit := asset.MustAlphaNum12()
		issuer, err = credit.Issuer.GetAddress()
		code = strings.TrimRight(string(credit.AssetCode[:]), "\x00")
	case xdr.AssetTypeAssetTypePoolShare:
		pool := asset.MustLiquidityPoolId()
		poolID = hex.EncodeToString(pool[:])
	default:
		return "", "", "", fmt.Errorf("unsupported trustline asset type %d", asset.Type)
	}
	if err != nil {
		return "", "", "", fmt.Errorf("encode trustline asset issuer: %w", err)
	}
	return code, issuer, poolID, nil
}

func ledgerEntrySponsor(entry xdr.LedgerEntry) (string, bool, error) {
	extension, ok := entry.Ext.GetV1()
	if !ok || extension.SponsoringId == nil {
		return "", false, nil
	}
	sponsor, err := extension.SponsoringId.GetAddress()
	if err != nil {
		return "", false, fmt.Errorf("encode ledger entry sponsor: %w", err)
	}
	return sponsor, true, nil
}

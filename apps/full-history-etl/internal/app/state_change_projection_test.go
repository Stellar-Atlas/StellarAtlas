package app

import (
	"encoding/hex"
	"reflect"
	"strings"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/stellar/go-stellar-sdk/xdr"
)

type projectedChangeProvenance struct {
	ledgerSequence    int64
	transactionIndex  int64
	changeIndex       int64
	transactionHash   string
	reason            string
	operationIndex    int64
	hasOperationIndex bool
	upgradeIndex      int64
	hasUpgradeIndex   bool
	changeType        int32
	changeTypeString  string
	deleted           bool
	ledgerKeySHA256   string
}

func assertStateChangeProjections(
	t *testing.T,
	root string,
	receipt ProcessingReceipt,
	changes []model.LedgerEntryChange,
) {
	t.Helper()
	accounts := readTypedRows[model.AccountStateChange](t, datasetPath(t, root, receipt, "account-state-changes"))
	trustlines := readTypedRows[model.TrustlineStateChange](t, datasetPath(t, root, receipt, "trustline-state-changes"))
	if len(accounts) != 501 || len(trustlines) != 187 {
		t.Fatalf("unexpected state change counts: accounts=%d trustlines=%d", len(accounts), len(trustlines))
	}
	ledgers := readTypedRows[model.Ledger](t, datasetPath(t, root, receipt, "ledgers"))
	if len(ledgers) != 1 {
		t.Fatalf("got %d ledger rows, expected 1", len(ledgers))
	}

	accountIndex, trustlineIndex := 0, 0
	accountDeletions, trustlineDeletions := 0, 0
	wantAccountDeletions, wantTrustlineDeletions := 0, 0
	hasBeyondFloatPrecision := false
	hasExtendedAccountState, hasPoolUseCount := false, false
	for changeIndex, change := range changes {
		switch xdr.LedgerEntryType(change.EntryType) {
		case xdr.LedgerEntryTypeAccount:
			if change.ChangeType == int32(xdr.LedgerEntryChangeTypeLedgerEntryRemoved) {
				wantAccountDeletions++
			}
			if accountIndex >= len(accounts) {
				t.Fatalf("ledger change %d has no account projection", changeIndex)
			}
			assertAccountStateChange(t, changeIndex, change, accounts[accountIndex], ledgers[0].ClosedAtUnixMillis)
			if accounts[accountIndex].Deleted {
				accountDeletions++
			}
			hasBeyondFloatPrecision = hasBeyondFloatPrecision || containsLargeInt64(
				accounts[accountIndex].Balance, accounts[accountIndex].BuyingLiabilities, accounts[accountIndex].SellingLiabilities,
			)
			hasExtendedAccountState = hasExtendedAccountState || accounts[accountIndex].HasInflationDest ||
				accounts[accountIndex].HasSequenceMetadata || accounts[accountIndex].SignerCount > 0
			accountIndex++
		case xdr.LedgerEntryTypeTrustline:
			if change.ChangeType == int32(xdr.LedgerEntryChangeTypeLedgerEntryRemoved) {
				wantTrustlineDeletions++
			}
			if trustlineIndex >= len(trustlines) {
				t.Fatalf("ledger change %d has no trustline projection", changeIndex)
			}
			assertTrustlineStateChange(t, changeIndex, change, trustlines[trustlineIndex], ledgers[0].ClosedAtUnixMillis)
			if trustlines[trustlineIndex].Deleted {
				trustlineDeletions++
			}
			hasBeyondFloatPrecision = hasBeyondFloatPrecision || containsLargeInt64(
				trustlines[trustlineIndex].Balance, trustlines[trustlineIndex].Limit,
				trustlines[trustlineIndex].BuyingLiabilities, trustlines[trustlineIndex].SellingLiabilities,
			)
			hasPoolUseCount = hasPoolUseCount || trustlines[trustlineIndex].LiquidityPoolUseCount != 0
			trustlineIndex++
		}
	}
	if accountIndex != len(accounts) || trustlineIndex != len(trustlines) {
		t.Fatalf("unmatched state projections: accounts=%d/%d trustlines=%d/%d", accountIndex, len(accounts), trustlineIndex, len(trustlines))
	}
	if accountDeletions != wantAccountDeletions || trustlineDeletions != wantTrustlineDeletions {
		t.Fatalf("state deletion counts do not match XDR: accounts=%d/%d trustlines=%d/%d", accountDeletions, wantAccountDeletions, trustlineDeletions, wantTrustlineDeletions)
	}
	if accountDeletions+trustlineDeletions == 0 {
		t.Fatal("fixture did not exercise a state deletion row")
	}
	if !hasBeyondFloatPrecision {
		t.Fatal("fixture did not exercise an int64 state value beyond exact float64 precision")
	}
	if !hasExtendedAccountState || !hasPoolUseCount {
		t.Fatalf("fixture did not exercise extended state: account=%t pool-use=%t", hasExtendedAccountState, hasPoolUseCount)
	}
}

func containsLargeInt64(values ...int64) bool {
	const maxExactFloatInteger = int64(1 << 53)
	for _, value := range values {
		if value > maxExactFloatInteger || value < -maxExactFloatInteger {
			return true
		}
	}
	return false
}

func assertAccountStateChange(
	t *testing.T,
	index int,
	change model.LedgerEntryChange,
	row model.AccountStateChange,
	closedAt int64,
) {
	t.Helper()
	assertProjectedProvenance(t, index, change, accountChangeProvenance(row))
	entry := effectiveFixtureEntry(t, index, change)
	account := entry.Data.MustAccount()
	key := fixtureLedgerKey(t, index, change)
	keyAccount := key.MustAccount()
	accountID := mustAccountAddress(t, account.AccountId)
	if accountID != mustAccountAddress(t, keyAccount.AccountId) || row.AccountID != accountID {
		t.Fatalf("account change %d identity does not match LedgerEntry/LedgerKey XDR", index)
	}
	extension := fixtureAccountExtensionValues(t, account)
	inflationDestination, hasInflationDestination := fixtureOptionalAccountAddress(t, account.InflationDest)
	stateEntryXDR, err := entry.MarshalBinary()
	if err != nil {
		t.Fatalf("account change %d effective state XDR: %v", index, err)
	}
	wantValues := []any{
		string(stateEntryXDR), int64(entry.LastModifiedLedgerSeq), int64(account.Balance), extension.buying, extension.selling, int64(account.SeqNum),
		extension.sequenceLedger, extension.sequenceTime, extension.hasSequenceMetadata,
		int64(account.NumSubEntries), int64(account.Flags), string(account.HomeDomain),
		inflationDestination, hasInflationDestination,
		int32(account.Thresholds[0]), int32(account.Thresholds[1]), int32(account.Thresholds[2]), int32(account.Thresholds[3]),
		extension.sponsored, extension.sponsoring, int64(len(account.Signers)), extension.signerKeys,
		extension.signerWeights, extension.signerSponsors, closedAt,
	}
	gotValues := []any{
		row.StateEntryXDR, row.LastModifiedLedger, row.Balance, row.BuyingLiabilities, row.SellingLiabilities, row.SequenceNumber,
		row.SequenceLedger, row.SequenceTime, row.HasSequenceMetadata,
		row.SubentryCount, row.Flags, row.HomeDomain,
		row.InflationDestination, row.HasInflationDest,
		row.MasterWeight, row.LowThreshold, row.MediumThreshold, row.HighThreshold,
		row.SponsoredEntryCount, row.SponsoringEntryCount, row.SignerCount, row.SignerKeys,
		row.SignerWeights, row.SignerSponsors, row.ClosedAtUnixMillis,
	}
	if !reflect.DeepEqual(gotValues, wantValues) {
		t.Fatalf("account change %d typed values do not match effective LedgerEntry XDR\ngot:  %v\nwant: %v", index, gotValues, wantValues)
	}
	assertFixtureSponsor(t, index, entry, row.Sponsor, row.HasSponsor)
}

func assertTrustlineStateChange(
	t *testing.T,
	index int,
	change model.LedgerEntryChange,
	row model.TrustlineStateChange,
	closedAt int64,
) {
	t.Helper()
	assertProjectedProvenance(t, index, change, trustlineChangeProvenance(row))
	entry := effectiveFixtureEntry(t, index, change)
	trustline := entry.Data.MustTrustLine()
	key := fixtureLedgerKey(t, index, change)
	keyTrustline := key.MustTrustLine()
	accountID := mustAccountAddress(t, trustline.AccountId)
	if accountID != mustAccountAddress(t, keyTrustline.AccountId) || row.AccountID != accountID || !trustline.Asset.Equals(keyTrustline.Asset) {
		t.Fatalf("trustline change %d identity does not match LedgerEntry/LedgerKey XDR", index)
	}
	assetCode, assetIssuer, poolID := fixtureTrustlineAssetIdentity(t, trustline.Asset)
	buying, selling, poolUseCount := fixtureTrustlineExtensionValues(trustline)
	stateEntryXDR, err := entry.MarshalBinary()
	if err != nil {
		t.Fatalf("trustline change %d effective state XDR: %v", index, err)
	}
	wantValues := []any{
		string(stateEntryXDR), int64(entry.LastModifiedLedgerSeq), int32(trustline.Asset.Type), trustline.Asset.Type.String(), assetCode, assetIssuer, poolID,
		int64(trustline.Balance), int64(trustline.Limit), buying, selling, poolUseCount, int64(trustline.Flags), closedAt,
	}
	gotValues := []any{
		row.StateEntryXDR, row.LastModifiedLedger, row.AssetType, row.AssetTypeString, row.AssetCode, row.AssetIssuer, row.LiquidityPoolID,
		row.Balance, row.Limit, row.BuyingLiabilities, row.SellingLiabilities, row.LiquidityPoolUseCount, row.Flags, row.ClosedAtUnixMillis,
	}
	if !reflect.DeepEqual(gotValues, wantValues) {
		t.Fatalf("trustline change %d typed values do not match effective LedgerEntry XDR\ngot:  %v\nwant: %v", index, gotValues, wantValues)
	}
	assertFixtureSponsor(t, index, entry, row.Sponsor, row.HasSponsor)
}

func assertProjectedProvenance(t *testing.T, index int, change model.LedgerEntryChange, got projectedChangeProvenance) {
	t.Helper()
	want := projectedChangeProvenance{
		ledgerSequence: change.LedgerSequence, transactionIndex: change.TransactionIndex,
		changeIndex: change.ChangeIndex, transactionHash: change.TransactionHash, reason: change.Reason,
		operationIndex: change.OperationIndex, hasOperationIndex: change.HasOperationIndex,
		upgradeIndex: change.UpgradeIndex, hasUpgradeIndex: change.HasUpgradeIndex,
		changeType: change.ChangeType, changeTypeString: change.ChangeTypeString,
		deleted: change.ChangeType == int32(xdr.LedgerEntryChangeTypeLedgerEntryRemoved), ledgerKeySHA256: change.LedgerKeySHA256,
	}
	if got != want {
		t.Fatalf("state change %d provenance mismatch\ngot:  %+v\nwant: %+v", index, got, want)
	}
}

func accountChangeProvenance(row model.AccountStateChange) projectedChangeProvenance {
	return projectedChangeProvenance{
		ledgerSequence: row.LedgerSequence, transactionIndex: row.TransactionIndex, changeIndex: row.ChangeIndex,
		transactionHash: row.TransactionHash, reason: row.Reason, operationIndex: row.OperationIndex,
		hasOperationIndex: row.HasOperationIndex, upgradeIndex: row.UpgradeIndex, hasUpgradeIndex: row.HasUpgradeIndex,
		changeType: row.ChangeType, changeTypeString: row.ChangeTypeString, deleted: row.Deleted, ledgerKeySHA256: row.LedgerKeySHA256,
	}
}

func trustlineChangeProvenance(row model.TrustlineStateChange) projectedChangeProvenance {
	return projectedChangeProvenance{
		ledgerSequence: row.LedgerSequence, transactionIndex: row.TransactionIndex, changeIndex: row.ChangeIndex,
		transactionHash: row.TransactionHash, reason: row.Reason, operationIndex: row.OperationIndex,
		hasOperationIndex: row.HasOperationIndex, upgradeIndex: row.UpgradeIndex, hasUpgradeIndex: row.HasUpgradeIndex,
		changeType: row.ChangeType, changeTypeString: row.ChangeTypeString, deleted: row.Deleted, ledgerKeySHA256: row.LedgerKeySHA256,
	}
}

func effectiveFixtureEntry(t *testing.T, index int, change model.LedgerEntryChange) xdr.LedgerEntry {
	t.Helper()
	encoded := change.PostEntryXDR
	if change.ChangeType == int32(xdr.LedgerEntryChangeTypeLedgerEntryRemoved) {
		encoded = change.PreEntryXDR
	}
	var entry xdr.LedgerEntry
	if err := entry.UnmarshalBinary([]byte(encoded)); err != nil {
		t.Fatalf("state change %d effective LedgerEntry XDR: %v", index, err)
	}
	return entry
}

func fixtureLedgerKey(t *testing.T, index int, change model.LedgerEntryChange) xdr.LedgerKey {
	t.Helper()
	var key xdr.LedgerKey
	if err := key.UnmarshalBinary([]byte(change.LedgerKeyXDR)); err != nil {
		t.Fatalf("state change %d LedgerKey XDR: %v", index, err)
	}
	return key
}

type fixtureAccountExtension struct {
	buying, selling, sponsored, sponsoring int64
	sequenceLedger, sequenceTime           int64
	hasSequenceMetadata                    bool
	signerKeys, signerSponsors             []string
	signerWeights                          []int32
}

func fixtureAccountExtensionValues(t *testing.T, account xdr.AccountEntry) fixtureAccountExtension {
	t.Helper()
	value := fixtureAccountExtension{}
	if len(account.Signers) > 0 {
		value.signerKeys = make([]string, len(account.Signers))
		value.signerWeights = make([]int32, len(account.Signers))
		value.signerSponsors = make([]string, len(account.Signers))
	}
	for index, signer := range account.Signers {
		address, err := signer.Key.GetAddress()
		if err != nil {
			t.Fatalf("encode signer %d key: %v", index, err)
		}
		value.signerKeys[index], value.signerWeights[index] = address, int32(signer.Weight)
	}
	v1, ok := account.Ext.GetV1()
	if !ok {
		return value
	}
	value.buying, value.selling = int64(v1.Liabilities.Buying), int64(v1.Liabilities.Selling)
	if v2, ok := v1.Ext.GetV2(); ok {
		value.sponsored, value.sponsoring = int64(v2.NumSponsored), int64(v2.NumSponsoring)
		if len(v2.SignerSponsoringIDs) != len(account.Signers) {
			t.Fatalf("signer sponsorship count %d does not match signer count %d", len(v2.SignerSponsoringIDs), len(account.Signers))
		}
		for index, sponsor := range v2.SignerSponsoringIDs {
			if sponsor != nil {
				value.signerSponsors[index] = mustAccountAddress(t, *sponsor)
			}
		}
		if v3, ok := v2.Ext.GetV3(); ok {
			value.sequenceLedger, value.sequenceTime = int64(v3.SeqLedger), int64(v3.SeqTime)
			value.hasSequenceMetadata = true
		}
	}
	return value
}

func fixtureTrustlineExtensionValues(trustline xdr.TrustLineEntry) (buying, selling int64, poolUseCount int32) {
	if v1, ok := trustline.Ext.GetV1(); ok {
		if v2, ok := v1.Ext.GetV2(); ok {
			poolUseCount = int32(v2.LiquidityPoolUseCount)
		}
		return int64(v1.Liabilities.Buying), int64(v1.Liabilities.Selling), poolUseCount
	}
	return 0, 0, 0
}

func fixtureOptionalAccountAddress(t *testing.T, account *xdr.AccountId) (string, bool) {
	t.Helper()
	if account == nil {
		return "", false
	}
	return mustAccountAddress(t, *account), true
}

func fixtureTrustlineAssetIdentity(t *testing.T, asset xdr.TrustLineAsset) (code, issuer, poolID string) {
	t.Helper()
	switch asset.Type {
	case xdr.AssetTypeAssetTypeNative:
	case xdr.AssetTypeAssetTypeCreditAlphanum4:
		credit := asset.MustAlphaNum4()
		code, issuer = strings.TrimRight(string(credit.AssetCode[:]), "\x00"), mustAccountAddress(t, credit.Issuer)
	case xdr.AssetTypeAssetTypeCreditAlphanum12:
		credit := asset.MustAlphaNum12()
		code, issuer = strings.TrimRight(string(credit.AssetCode[:]), "\x00"), mustAccountAddress(t, credit.Issuer)
	case xdr.AssetTypeAssetTypePoolShare:
		pool := asset.MustLiquidityPoolId()
		poolID = hex.EncodeToString(pool[:])
	default:
		t.Fatalf("unsupported fixture trustline asset type %d", asset.Type)
	}
	return code, issuer, poolID
}

func assertFixtureSponsor(t *testing.T, index int, entry xdr.LedgerEntry, sponsor string, hasSponsor bool) {
	t.Helper()
	extension, ok := entry.Ext.GetV1()
	wantHasSponsor := ok && extension.SponsoringId != nil
	wantSponsor := ""
	if wantHasSponsor {
		wantSponsor = mustAccountAddress(t, *extension.SponsoringId)
	}
	if sponsor != wantSponsor || hasSponsor != wantHasSponsor {
		t.Fatalf("state change %d sponsor does not match LedgerEntry extension", index)
	}
}

func mustAccountAddress(t *testing.T, account xdr.AccountId) string {
	t.Helper()
	address, err := account.GetAddress()
	if err != nil {
		t.Fatalf("encode fixture account ID: %v", err)
	}
	return address
}

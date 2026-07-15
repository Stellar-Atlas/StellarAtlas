package stateexport

import (
	"encoding/base64"
	"fmt"
	"math"
	"strconv"
	"unicode/utf8"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
)

const Version = "stellar-atlas.full-history-state-export.v1"

type Dataset string

const (
	AccountStateChanges   Dataset = "account-state-changes"
	Ledgers               Dataset = "ledgers"
	TrustlineStateChanges Dataset = "trustline-state-changes"
)

func ParseDataset(value string) (Dataset, error) {
	dataset := Dataset(value)
	if err := dataset.Validate(); err != nil {
		return "", err
	}
	return dataset, nil
}

func (d Dataset) Validate() error {
	switch d {
	case AccountStateChanges, Ledgers, TrustlineStateChanges:
		return nil
	default:
		return fmt.Errorf("unsupported dataset %q", d)
	}
}

type header struct {
	Type         string  `json:"type"`
	Version      string  `json:"version"`
	Dataset      Dataset `json:"dataset"`
	SourceSHA256 string  `json:"sourceSha256"`
}

type rowEnvelope[T any] struct {
	Type    string  `json:"type"`
	Dataset Dataset `json:"dataset"`
	Value   T       `json:"value"`
}

type complete struct {
	Type        string  `json:"type"`
	Dataset     Dataset `json:"dataset"`
	RecordCount string  `json:"recordCount"`
}

type provenance struct {
	ChangeIndex         string  `json:"changeIndex"`
	ChangeType          int32   `json:"changeType"`
	ChangeTypeString    string  `json:"changeTypeString"`
	ClosedAtUnixMillis  string  `json:"closedAtUnixMillis"`
	Deleted             bool    `json:"deleted"`
	LastModifiedLedger  string  `json:"lastModifiedLedger"`
	LedgerKeySHA256     string  `json:"ledgerKeySha256"`
	LedgerSequence      string  `json:"ledgerSequence"`
	OperationIndex      *string `json:"operationIndex"`
	Reason              string  `json:"reason"`
	Sponsor             *string `json:"sponsor"`
	StateEntryXDRBase64 string  `json:"stateEntryXdrBase64"`
	TransactionHash     string  `json:"transactionHash"`
	TransactionIndex    string  `json:"transactionIndex"`
	UpgradeIndex        *string `json:"upgradeIndex"`
}

type accountValue struct {
	provenance
	AccountID            string    `json:"accountId"`
	Balance              string    `json:"balance"`
	BuyingLiabilities    string    `json:"buyingLiabilities"`
	Flags                string    `json:"flags"`
	HighThreshold        int32     `json:"highThreshold"`
	HomeDomain           string    `json:"homeDomain"`
	InflationDestination *string   `json:"inflationDestination"`
	LowThreshold         int32     `json:"lowThreshold"`
	MasterWeight         int32     `json:"masterWeight"`
	MediumThreshold      int32     `json:"mediumThreshold"`
	SequenceLedger       *string   `json:"sequenceLedger"`
	SequenceNumber       string    `json:"sequenceNumber"`
	SequenceTime         *string   `json:"sequenceTime"`
	SignerCount          string    `json:"signerCount"`
	SignerKeys           []string  `json:"signerKeys"`
	SignerSponsors       []*string `json:"signerSponsors"`
	SignerWeights        []int32   `json:"signerWeights"`
	SellingLiabilities   string    `json:"sellingLiabilities"`
	SponsoredEntryCount  string    `json:"sponsoredEntryCount"`
	SponsoringEntryCount string    `json:"sponsoringEntryCount"`
	SubentryCount        string    `json:"subentryCount"`
}

type trustlineValue struct {
	provenance
	AccountID             string `json:"accountId"`
	AssetCode             string `json:"assetCode"`
	AssetIssuer           string `json:"assetIssuer"`
	AssetType             int32  `json:"assetType"`
	AssetTypeString       string `json:"assetTypeString"`
	Balance               string `json:"balance"`
	BuyingLiabilities     string `json:"buyingLiabilities"`
	Flags                 string `json:"flags"`
	Limit                 string `json:"limit"`
	LiquidityPoolID       string `json:"liquidityPoolId"`
	LiquidityPoolUseCount int32  `json:"liquidityPoolUseCount"`
	SellingLiabilities    string `json:"sellingLiabilities"`
}

type ledgerValue struct {
	LedgerSequence           string `json:"ledgerSequence"`
	LedgerHash               string `json:"ledgerHash"`
	PreviousLedgerHash       string `json:"previousLedgerHash"`
	TransactionSetHash       string `json:"transactionSetHash"`
	TransactionResultSetHash string `json:"transactionResultSetHash"`
	BucketListHash           string `json:"bucketListHash"`
	ProtocolVersion          int32  `json:"protocolVersion"`
	ClosedAtUnixMillis       string `json:"closedAtUnixMillis"`
	TransactionCount         string `json:"transactionCount"`
}

type provenanceSource struct {
	ledgerSequence, transactionIndex, changeIndex int64
	transactionHash, reason                       string
	operationIndex                                int64
	hasOperationIndex                             bool
	upgradeIndex                                  int64
	hasUpgradeIndex                               bool
	changeType                                    int32
	changeTypeString                              string
	deleted                                       bool
	ledgerKeySHA256, stateEntryXDR                string
	lastModifiedLedger                            int64
	sponsor                                       string
	hasSponsor                                    bool
	closedAtUnixMillis                            int64
}

func makeAccountValue(row model.AccountStateChange) (accountValue, error) {
	common, err := makeProvenance(accountProvenance(row))
	if err != nil {
		return accountValue{}, err
	}
	if err := validateTextFields(
		textField{"accountId", row.AccountID},
		textField{"homeDomain", row.HomeDomain},
	); err != nil {
		return accountValue{}, err
	}
	if row.HasInflationDest && !utf8.ValidString(row.InflationDestination) {
		return accountValue{}, fmt.Errorf("inflationDestination is not valid UTF-8")
	}
	if row.SignerCount != int64(len(row.SignerKeys)) ||
		row.SignerCount != int64(len(row.SignerWeights)) ||
		row.SignerCount != int64(len(row.SignerSponsors)) {
		return accountValue{}, fmt.Errorf(
			"signerCount %d does not match signer arrays (%d, %d, %d)",
			row.SignerCount, len(row.SignerKeys), len(row.SignerWeights), len(row.SignerSponsors),
		)
	}
	keys := append(make([]string, 0, len(row.SignerKeys)), row.SignerKeys...)
	weights := append(make([]int32, 0, len(row.SignerWeights)), row.SignerWeights...)
	sponsors := make([]*string, len(row.SignerSponsors))
	for index := range keys {
		if !utf8.ValidString(keys[index]) {
			return accountValue{}, fmt.Errorf("signerKeys[%d] is not valid UTF-8", index)
		}
		if row.SignerSponsors[index] == "" {
			continue
		}
		if !utf8.ValidString(row.SignerSponsors[index]) {
			return accountValue{}, fmt.Errorf("signerSponsors[%d] is not valid UTF-8", index)
		}
		sponsors[index] = textPointer(row.SignerSponsors[index])
	}
	return accountValue{
		provenance: common,
		AccountID:  row.AccountID, Balance: decimal(row.Balance),
		BuyingLiabilities: decimal(row.BuyingLiabilities), Flags: decimal(row.Flags),
		HighThreshold: row.HighThreshold, HomeDomain: row.HomeDomain,
		InflationDestination: optionalText(row.InflationDestination, row.HasInflationDest),
		LowThreshold:         row.LowThreshold, MasterWeight: row.MasterWeight, MediumThreshold: row.MediumThreshold,
		SequenceLedger: optionalDecimal(row.SequenceLedger, row.HasSequenceMetadata),
		SequenceNumber: decimal(row.SequenceNumber), SequenceTime: optionalDecimal(row.SequenceTime, row.HasSequenceMetadata),
		SignerCount: decimal(row.SignerCount), SignerKeys: keys, SignerSponsors: sponsors, SignerWeights: weights,
		SellingLiabilities: decimal(row.SellingLiabilities), SponsoredEntryCount: decimal(row.SponsoredEntryCount),
		SponsoringEntryCount: decimal(row.SponsoringEntryCount), SubentryCount: decimal(row.SubentryCount),
	}, nil
}

func makeTrustlineValue(row model.TrustlineStateChange) (trustlineValue, error) {
	common, err := makeProvenance(trustlineProvenance(row))
	if err != nil {
		return trustlineValue{}, err
	}
	if err := validateTextFields(
		textField{"accountId", row.AccountID}, textField{"assetCode", row.AssetCode},
		textField{"assetIssuer", row.AssetIssuer}, textField{"assetTypeString", row.AssetTypeString},
		textField{"liquidityPoolId", row.LiquidityPoolID},
	); err != nil {
		return trustlineValue{}, err
	}
	return trustlineValue{
		provenance: common,
		AccountID:  row.AccountID, AssetCode: row.AssetCode, AssetIssuer: row.AssetIssuer,
		AssetType: row.AssetType, AssetTypeString: row.AssetTypeString,
		Balance: decimal(row.Balance), BuyingLiabilities: decimal(row.BuyingLiabilities), Flags: decimal(row.Flags),
		Limit: decimal(row.Limit), LiquidityPoolID: row.LiquidityPoolID,
		LiquidityPoolUseCount: row.LiquidityPoolUseCount, SellingLiabilities: decimal(row.SellingLiabilities),
	}, nil
}

func makeLedgerValue(row model.Ledger) (ledgerValue, error) {
	if err := validateLowerHexHashes(
		textField{"ledgerHash", row.LedgerHash},
		textField{"previousLedgerHash", row.PreviousLedgerHash},
		textField{"transactionSetHash", row.TransactionSetHash},
		textField{"transactionResultSetHash", row.TransactionResultSetHash},
		textField{"bucketListHash", row.BucketListHash},
	); err != nil {
		return ledgerValue{}, err
	}
	if row.ProtocolVersion < 0 || row.ProtocolVersion > math.MaxInt32 {
		return ledgerValue{}, fmt.Errorf("protocolVersion %d is outside the non-negative int32 range", row.ProtocolVersion)
	}
	return ledgerValue{
		LedgerSequence:           decimal(row.LedgerSequence),
		LedgerHash:               row.LedgerHash,
		PreviousLedgerHash:       row.PreviousLedgerHash,
		TransactionSetHash:       row.TransactionSetHash,
		TransactionResultSetHash: row.TransactionResultSetHash,
		BucketListHash:           row.BucketListHash,
		ProtocolVersion:          int32(row.ProtocolVersion),
		ClosedAtUnixMillis:       decimal(row.ClosedAtUnixMillis),
		TransactionCount:         decimal(row.TransactionCount),
	}, nil
}

func validateLowerHexHashes(fields ...textField) error {
	for _, field := range fields {
		if len(field.value) != 64 {
			return fmt.Errorf("%s must be exactly 64 lowercase hexadecimal characters", field.name)
		}
		for index := range field.value {
			character := field.value[index]
			if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
				return fmt.Errorf("%s must be exactly 64 lowercase hexadecimal characters", field.name)
			}
		}
	}
	return nil
}

func makeProvenance(row provenanceSource) (provenance, error) {
	if err := validateTextFields(
		textField{"transactionHash", row.transactionHash}, textField{"reason", row.reason},
		textField{"changeTypeString", row.changeTypeString}, textField{"ledgerKeySha256", row.ledgerKeySHA256},
	); err != nil {
		return provenance{}, err
	}
	if row.hasSponsor && !utf8.ValidString(row.sponsor) {
		return provenance{}, fmt.Errorf("sponsor is not valid UTF-8")
	}
	return provenance{
		ChangeIndex: decimal(row.changeIndex), ChangeType: row.changeType, ChangeTypeString: row.changeTypeString,
		ClosedAtUnixMillis: decimal(row.closedAtUnixMillis), Deleted: row.deleted,
		LastModifiedLedger: decimal(row.lastModifiedLedger), LedgerKeySHA256: row.ledgerKeySHA256,
		LedgerSequence: decimal(row.ledgerSequence), OperationIndex: optionalDecimal(row.operationIndex, row.hasOperationIndex),
		Reason: row.reason, Sponsor: optionalText(row.sponsor, row.hasSponsor),
		StateEntryXDRBase64: base64.StdEncoding.EncodeToString([]byte(row.stateEntryXDR)),
		TransactionHash:     row.transactionHash, TransactionIndex: decimal(row.transactionIndex),
		UpgradeIndex: optionalDecimal(row.upgradeIndex, row.hasUpgradeIndex),
	}, nil
}

func accountProvenance(row model.AccountStateChange) provenanceSource {
	return provenanceSource{
		row.LedgerSequence, row.TransactionIndex, row.ChangeIndex, row.TransactionHash, row.Reason,
		row.OperationIndex, row.HasOperationIndex, row.UpgradeIndex, row.HasUpgradeIndex,
		row.ChangeType, row.ChangeTypeString, row.Deleted, row.LedgerKeySHA256, row.StateEntryXDR,
		row.LastModifiedLedger, row.Sponsor, row.HasSponsor, row.ClosedAtUnixMillis,
	}
}

func trustlineProvenance(row model.TrustlineStateChange) provenanceSource {
	return provenanceSource{
		row.LedgerSequence, row.TransactionIndex, row.ChangeIndex, row.TransactionHash, row.Reason,
		row.OperationIndex, row.HasOperationIndex, row.UpgradeIndex, row.HasUpgradeIndex,
		row.ChangeType, row.ChangeTypeString, row.Deleted, row.LedgerKeySHA256, row.StateEntryXDR,
		row.LastModifiedLedger, row.Sponsor, row.HasSponsor, row.ClosedAtUnixMillis,
	}
}

type textField struct {
	name, value string
}

func validateTextFields(fields ...textField) error {
	for _, field := range fields {
		if !utf8.ValidString(field.value) {
			return fmt.Errorf("%s is not valid UTF-8", field.name)
		}
	}
	return nil
}

func decimal(value int64) string {
	return strconv.FormatInt(value, 10)
}

func optionalDecimal(value int64, present bool) *string {
	if !present {
		return nil
	}
	return textPointer(decimal(value))
}

func optionalText(value string, present bool) *string {
	if !present {
		return nil
	}
	return textPointer(value)
}

func textPointer(value string) *string {
	return &value
}

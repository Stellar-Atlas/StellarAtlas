package clickhouse

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"
)

// appendEncodedRow emits exactly encodeRow's bytes plus one newline directly
// into the existing buffer. It avoids the Marshal result copy and the separate
// metadata-enriched row allocation. The returned view is valid only until the
// next buffer write; synchronous holder/pool capture must not retain it.
func appendEncodedRow(
	body *bytes.Buffer,
	row any,
	identity BatchIdentity,
	ledgerSequence uint32,
	rowNumber uint64,
	ingestedAt time.Time,
	cache ...rowMetadata,
) ([]byte, error) {
	start := body.Len()
	if err := json.NewEncoder(body).Encode(row); err != nil {
		body.Truncate(start)
		return nil, err
	}
	// Encoder adds one newline. Marshal and the default Encoder use identical
	// compact JSON/HTML escaping; inspect only this newly appended row.
	end := body.Len() - 1
	if err := validateEncodedObject(body.Bytes()[start:end]); err != nil {
		body.Truncate(start)
		return nil, err
	}
	body.Truncate(end)
	if len(cache) != 0 {
		return appendCachedRowMetadata(body, start, ledgerSequence, rowNumber, cache[0])
	}
	return appendRowMetadata(body, start, identity, ledgerSequence, rowNumber, ingestedAt)
}

func appendPreparedRow(
	body *bytes.Buffer,
	encoded []byte,
	identity BatchIdentity,
	ledgerSequence uint32,
	rowNumber uint64,
	ingestedAt time.Time,
	cache ...rowMetadata,
) ([]byte, error) {
	if err := validateEncodedObject(encoded); err != nil {
		return nil, err
	}
	start := body.Len()
	body.Write(encoded)
	if len(cache) != 0 {
		return appendCachedRowMetadata(body, start, ledgerSequence, rowNumber, cache[0])
	}
	return appendRowMetadata(body, start, identity, ledgerSequence, rowNumber, ingestedAt)
}

func validateEncodedObject(encoded []byte) error {
	if len(encoded) < 2 || encoded[0] != '{' || encoded[len(encoded)-1] != '}' {
		return fmt.Errorf("official stellar-etl row is not a JSON object")
	}
	return nil
}

func appendRowMetadata(
	body *bytes.Buffer,
	start int,
	identity BatchIdentity,
	ledgerSequence uint32,
	rowNumber uint64,
	ingestedAt time.Time,
) ([]byte, error) {
	metadata, err := json.Marshal(struct {
		BatchID      string `json:"_batch_id"`
		SourceSHA256 string `json:"_source_sha256"`
		Ledger       uint32 `json:"_ledger_sequence"`
		RowNumber    uint64 `json:"_row_number"`
		IngestedAt   string `json:"_ingested_at"`
	}{
		BatchID: identity.ID, SourceSHA256: identity.SourceSHA256,
		Ledger: ledgerSequence, RowNumber: rowNumber,
		IngestedAt: ingestedAt.Format(time.RFC3339Nano),
	})
	if err != nil {
		body.Truncate(start)
		return nil, err
	}
	end := body.Len()
	rowLength := end - start
	body.Truncate(end - 1)
	if rowLength > 2 {
		body.WriteByte(',')
	}
	body.Write(metadata[1:])
	end = body.Len()
	body.WriteByte('\n')
	return body.Bytes()[start:end], nil
}

package clickhouse

import (
	"bytes"
	"encoding/json"
	"errors"
	"strconv"
	"time"
)

// rowMetadata holds the immutable JSON fragments shared by rows in one batch.
type rowMetadata struct {
	prefix []byte
	suffix []byte
}

// Only the ordered writer calls this; projection workers never mutate metadata.
// Lazy initialization also leaves virtual-only writers without encoding work.
func (w *BatchWriter) metadataForRows() (rowMetadata, error) {
	if len(w.metadata.prefix) == 0 {
		metadata, err := newRowMetadata(w.identity.ID, w.identity.SourceSHA256, w.ingestedAt)
		if err != nil {
			return rowMetadata{}, err
		}
		w.metadata = metadata
	}
	return w.metadata, nil
}

func newRowMetadata(batchID, sourceSHA string, ingestedAt time.Time) (rowMetadata, error) {
	batch, err := json.Marshal(batchID)
	if err != nil {
		return rowMetadata{}, err
	}
	source, err := json.Marshal(sourceSHA)
	if err != nil {
		return rowMetadata{}, err
	}
	timestamp, err := json.Marshal(ingestedAt.Format(time.RFC3339Nano))
	if err != nil {
		return rowMetadata{}, err
	}

	prefix := make([]byte, 0, len(batch)+len(source)+48)
	prefix = append(prefix, `"_batch_id":`...)
	prefix = append(prefix, batch...)
	prefix = append(prefix, `,"_source_sha256":`...)
	prefix = append(prefix, source...)
	prefix = append(prefix, `,"_ledger_sequence":`...)

	suffix := make([]byte, 0, len(timestamp)+22)
	suffix = append(suffix, `,"_ingested_at":`...)
	suffix = append(suffix, timestamp...)
	suffix = append(suffix, '}')
	return rowMetadata{prefix: prefix, suffix: suffix}, nil
}

func appendCachedRowMetadata(body *bytes.Buffer, start int, ledger uint32, rowNumber uint64, metadata rowMetadata) ([]byte, error) {
	if body == nil || start < 0 || start > body.Len() {
		return nil, errors.New("invalid row body bounds")
	}
	data := body.Bytes()
	if len(data)-start < 2 || data[start] != '{' || data[len(data)-1] != '}' {
		return nil, errors.New("row body must be a JSON object")
	}
	if len(metadata.prefix) == 0 || len(metadata.suffix) == 0 || metadata.suffix[len(metadata.suffix)-1] != '}' {
		return nil, errors.New("invalid cached row metadata")
	}

	body.Truncate(body.Len() - 1)
	if body.Len()-start > 1 {
		body.WriteByte(',')
	}
	body.Write(metadata.prefix)
	var numeric [20]byte
	encoded := strconv.AppendUint(numeric[:0], uint64(ledger), 10)
	body.Write(encoded)
	body.WriteString(`,"_row_number":`)
	encoded = strconv.AppendUint(numeric[:0], rowNumber, 10)
	body.Write(encoded)
	body.Write(metadata.suffix)
	body.WriteByte('\n')
	return body.Bytes()[start : body.Len()-1], nil
}

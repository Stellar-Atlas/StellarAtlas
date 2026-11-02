#!/usr/bin/env python3
"""Verify one complete local history artifact, then inspect it with PyArrow."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import os
import sys


class ReaderUnavailable(Exception):
    pass


def decimal_field(descriptor: dict, name: str) -> int:
    value = descriptor.get(name)
    if not isinstance(value, str) or not re.fullmatch(r"0|[1-9][0-9]*", value):
        raise ValueError(f"{name} must be a decimal string from one selected output descriptor")
    return int(value)


def inspect_file(local_file: Path, descriptor_file: Path, preview: int) -> dict:
    if not 0 <= preview <= 10:
        raise ValueError("preview must be between 0 and 10 rows")
    if not descriptor_file.is_file() or descriptor_file.stat().st_size > 65_536:
        raise ValueError("Supply one local selected-output JSON object, at most 64 KiB")
    descriptor = json.loads(descriptor_file.read_text(encoding="utf-8"))
    if not isinstance(descriptor, dict):
        raise ValueError("Expected one selected output object, not a batch-list response")
    expected_size = decimal_field(descriptor, "byteCount")
    expected_rows = decimal_field(descriptor, "recordCount")
    expected_hash = descriptor.get("sha256")
    if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
        raise ValueError("sha256 must be the descriptor's lowercase 64-hex digest")
    if descriptor.get("mediaType") != "application/vnd.apache.parquet":
        raise ValueError("Select a Parquet output descriptor")
    version = descriptor.get("schemaVersion")
    if not isinstance(version, str) or not version.strip():
        raise ValueError("The selected descriptor must include schemaVersion")
    if not local_file.is_file():
        raise ValueError("Supply an explicit complete local file, not a URL, directory or glob")

    with local_file.open("rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError("The artifact must be a regular local file")
        digest = hashlib.sha256()
        actual_size = 0
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            actual_size += len(chunk)
        if actual_size != expected_size:
            raise ValueError(f"Size mismatch: expected {expected_size} bytes, read {actual_size}")
        if digest.hexdigest() != expected_hash:
            raise ValueError("SHA256 mismatch: do not inspect an unverified artifact")

        # Import/open the reader only after both complete-file checks succeeded.
        try:
            import pyarrow as pa
            reader_version = re.match(r"^([0-9]+)\.([0-9]+)\.([0-9]+)", pa.__version__)
            if reader_version is None or tuple(map(int, reader_version.groups())) < (14, 0, 1):
                raise ReaderUnavailable(
                    f"Bytes verified, but PyArrow 14.0.1+ is required; found {pa.__version__}. "
                    "Use a maintained reader (qualified with 26.0.0). Nothing was installed."
                )
            import pyarrow.parquet as pq
        except (ImportError, OSError) as error:
            raise ReaderUnavailable(
                "Bytes verified, but PyArrow 14.0.1+ is required for footer/schema/preview inspection. "
                "Use Python 3.11+ with a maintained PyArrow release (qualified with 26.0.0); "
                "see https://arrow.apache.org/docs/python/install.html. Nothing was installed."
            ) from error

        source.seek(0)
        with pq.ParquetFile(source) as parquet:
            metadata = parquet.metadata
            if metadata.num_rows != expected_rows:
                raise ValueError("Footer row count differs from the selected descriptor")
            columns = []
            for index in range(metadata.num_columns):
                column = parquet.schema.column(index)
                columns.append({
                    "name": column.name,
                    "physicalType": column.physical_type,
                    "convertedType": column.converted_type,
                    "logicalType": str(column.logical_type),
                    "definitionLevel": column.max_definition_level,
                    "repetitionLevel": column.max_repetition_level,
                })
            rows = []
            if preview:
                if descriptor.get("dataset") != "ledgers":
                    raise ValueError("This integer preview selects ledger columns; use --preview 0 for another dataset")
                wanted = {"ledger_sequence": pa.uint64(), "total_coins": pa.int64(), "fee_pool": pa.int64()}
                for name, expected_type in wanted.items():
                    if parquet.schema_arrow.field(name).type != expected_type:
                        raise ValueError(f"Unexpected logical type for {name}; inspect the schema before adapting the preview")
                batch = next(parquet.iter_batches(batch_size=preview, columns=list(wanted), use_threads=False), None)
                if batch is not None:
                    for index in range(batch.num_rows):
                        row = {}
                        for column_index, name in enumerate(wanted):
                            value = batch.column(column_index)[index].as_py()
                            if value is not None and type(value) is not int:
                                raise ValueError(f"Expected an exact integer for {name}")
                            row[name] = None if value is None else str(value)
                        rows.append(row)
            return {
                "verifiedByteCount": str(actual_size), "sha256": digest.hexdigest(),
                "descriptorSchemaVersion": version, "readerVersion": pa.__version__,
                "recordCount": str(metadata.num_rows), "columnCount": metadata.num_columns,
                "rowGroupCount": metadata.num_row_groups, "createdBy": metadata.created_by,
                "keyValueMetadata": {key.decode("utf-8", "backslashreplace"): value.decode("utf-8", "backslashreplace")
                                     for key, value in (metadata.metadata or {}).items()},
                "parquetSchema": columns, "arrowSchema": str(parquet.schema_arrow),
                "preview": rows,
            }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, help="already-downloaded complete Parquet file")
    parser.add_argument("descriptor", type=Path, help="saved selected output object, not the whole batch response")
    parser.add_argument("--preview", type=int, choices=range(0, 11), default=5,
                        help="display at most 0–10 ledger rows; 0 inspects metadata only")
    args = parser.parse_args()
    try:
        result = inspect_file(args.file, args.descriptor, args.preview)
    except ReaderUnavailable as error:
        print(error, file=sys.stderr)
        return 2
    except Exception as error:
        print(f"Inspection failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

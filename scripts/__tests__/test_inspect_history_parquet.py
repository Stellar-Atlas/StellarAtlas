"""Finite offline CLI checks; reader cases skip explicitly when PyArrow is absent."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
except ImportError:
    pa = pq = None

SCRIPT = Path(__file__).resolve().parents[1] / "inspect_history_parquet.py"


class LocalFiles(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="atlas-parquet-test-")
        self.directory = Path(self.temporary.name)
        def cleanup():
            if self.directory.resolve().parent != Path(tempfile.gettempdir()).resolve() or not self.directory.name.startswith("atlas-parquet-test-"):
                raise RuntimeError("Unexpected temporary fixture cleanup path")
            self.temporary.cleanup()
        self.addCleanup(cleanup)
        self.artifact = self.directory / "complete.parquet"
        self.descriptor = self.directory / "selected-output.json"

    def save_descriptor(self, records="0", **changes):
        value = {"byteCount": str(self.artifact.stat().st_size), "recordCount": records,
                 "sha256": hashlib.sha256(self.artifact.read_bytes()).hexdigest(),
                 "mediaType": "application/vnd.apache.parquet", "dataset": "ledgers",
                 "schemaVersion": "synthetic.ledgers.v1"}
        value.update(changes)
        self.descriptor.write_text(json.dumps(value), encoding="utf-8")

    def run_cli(self, preview=5, no_site=False):
        environment = os.environ.copy()
        if no_site:
            environment.pop("PYTHONPATH", None)
        return subprocess.run([sys.executable, *( ["-S"] if no_site else [] ), str(SCRIPT),
                               str(self.artifact), str(self.descriptor), "--preview", str(preview)],
                              capture_output=True, text=True, encoding="utf-8", timeout=15, env=environment)


class IntegrityAndPrerequisiteTests(LocalFiles):
    def setUp(self):
        super().setUp()
        self.artifact.write_bytes(b"local synthetic bytes, not a Parquet success fixture")
        self.save_descriptor()

    def test_missing_reader_has_actionable_prerequisite_not_a_success(self):
        result = self.run_cli(no_site=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertIn("Bytes verified, but PyArrow 14.0.1+ is required", result.stderr)
        self.assertIn("Nothing was installed", result.stderr)

    def test_size_mismatch_fails_before_missing_reader(self):
        self.save_descriptor(byteCount="1")
        result = self.run_cli(no_site=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Size mismatch", result.stderr)
        self.assertNotIn("PyArrow 14.0.1+ is required", result.stderr)

    def test_digest_mismatch_fails_before_missing_reader(self):
        self.save_descriptor(sha256="0" * 64)
        result = self.run_cli(no_site=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("SHA256 mismatch", result.stderr)

    def test_count_requires_exact_descriptor_string(self):
        self.save_descriptor(byteCount=self.artifact.stat().st_size)
        result = self.run_cli(no_site=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("byteCount must be a decimal string", result.stderr)

    def test_preview_is_bounded(self):
        result = self.run_cli(preview=11)
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid choice", result.stderr)


@unittest.skipIf(pa is None, "Prerequisite: PyArrow is required for actual Parquet reader checks")
class ParquetReaderTests(LocalFiles):
    def setUp(self):
        super().setUp()
        self.values = {
            "ledger_sequence": [18446744073709551615, 9007199254740993],
            "total_coins": [9223372036854775807, -9007199254740993],
            "fee_pool": [-9223372036854775808, 9007199254740993],
        }
        schema = pa.schema([pa.field("ledger_sequence", pa.uint64(), nullable=False),
                            pa.field("total_coins", pa.int64(), nullable=False),
                            pa.field("fee_pool", pa.int64(), nullable=False)])
        table = pa.Table.from_pydict(self.values, schema=schema)
        pq.write_table(table, self.artifact, version="2.6")
        self.save_descriptor(records="2")

    def test_exact_signed_and_unsigned_64_bit_preview_without_float(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["recordCount"], "2")
        self.assertEqual(output["columnCount"], 3)
        for index in range(2):
            self.assertEqual(output["preview"][index],
                             {name: str(values[index]) for name, values in self.values.items()})
        self.assertEqual([column["physicalType"] for column in output["parquetSchema"]], ["INT64"] * 3)
        self.assertIn("ledger_sequence: uint64", output["arrowSchema"])
        self.assertIn("total_coins: int64", output["arrowSchema"])

    def test_only_the_requested_first_batch_is_displayed(self):
        result = self.run_cli(preview=1)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads(result.stdout)["preview"]), 1)

    def test_metadata_only_has_no_preview(self):
        result = self.run_cli(preview=0)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["preview"], [])

    def test_record_count_mismatch_is_rejected(self):
        self.save_descriptor(records="3")
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn("Footer row count differs", result.stderr)

    def test_truncated_complete_file_fails_integrity(self):
        self.artifact.write_bytes(self.artifact.read_bytes()[:-3])
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn("Size mismatch", result.stderr)

    def test_truncated_footer_is_rejected_even_if_selected_digest_matches(self):
        self.artifact.write_bytes(self.artifact.read_bytes()[:-3])
        self.save_descriptor(records="2")
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn("Inspection failed", result.stderr)
        self.assertNotIn("mismatch", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)

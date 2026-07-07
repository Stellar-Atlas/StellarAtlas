import * as path from 'path';
import * as fs from 'fs';
import { gunzipSync } from 'zlib';
import { fileURLToPath } from 'node:url';
import {
	processTransactionHistoryEntryXDR,
	processTransactionHistoryResultEntryXDR
} from '../hash-worker.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(currentDir, '../__fixtures__');

it('should extract transaction envelope records from a real archive fixture', () => {
	const result = processTransactionHistoryEntryXDR(
		firstXdrFrame(path.join(fixturesDir, 'transactions.xdr.gz'))
	);

	expect(result).toMatchObject({
		hash: 'rx/vbqe2TibD5lhk3swAgQzeMud7rPtqZgKdangjWIA=',
		ledger: 556808
	});
	expect(result.envelopes).toHaveLength(1);
	expect(result.envelopes[0]).toEqual({
		envelopeXdr: expect.any(String),
		transactionIndex: 0
	});
});

it('should extract transaction result records from a real archive fixture', () => {
	const result = processTransactionHistoryResultEntryXDR(
		firstXdrFrame(path.join(fixturesDir, 'results.xdr.gz'))
	);

	expect(result).toMatchObject({
		hash: 'xd+H6dyxensZskf4Hhv7OQ8BB6HcdvKBQ7sgzySj6Ts=',
		ledger: 556808
	});
	expect(result.results).toHaveLength(1);
	expect(result.results[0]).toEqual({
		resultXdr: expect.any(String),
		transactionHash: expect.any(String),
		transactionIndex: 0
	});
});

function firstXdrFrame(filePath: string): Buffer {
	const unzipped = gunzipSync(fs.readFileSync(filePath));
	const length = Buffer.from(unzipped.subarray(0, 4));
	length[0] &= 0x7f;
	const frameLength = length.readUInt32BE(0);
	return unzipped.subarray(4, 4 + frameLength);
}

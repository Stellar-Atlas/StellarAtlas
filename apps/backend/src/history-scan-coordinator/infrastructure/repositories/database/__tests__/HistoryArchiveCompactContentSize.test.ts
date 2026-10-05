import { contentFactsForStorage } from '../HistoryArchiveCompactContentFacts.js';
import type { PreparedContentCompletion } from '../HistoryArchiveContentReuseWrite.js';

const bytes = (value: unknown): number =>
	Buffer.byteLength(JSON.stringify(value), 'utf8');

function prepared(hashes: readonly string[]): PreparedContentCompletion {
	return {
		reuse: {
			artifactId: '11111111-1111-4111-8111-111111111111',
			sourceObjectRemoteId: '22222222-2222-4222-8222-222222222222',
			contentDigest: 'a'.repeat(64),
			contentRepresentation: 'uncompressed-xdr',
			derivationVersion: 1
		},
		progress: {
			claimAttempt: 1,
			verificationFacts: {
				content: {
					algorithm: 'sha256',
					digest: 'a'.repeat(64),
					representation: 'uncompressed-xdr'
				},
				resultsCategory: {
					entryCount: hashes.length,
					sourceUrl: 'https://archive.example/results/0000003f.xdr.gz',
					ledgers: hashes.map((transactionResultSetHash, ledger) => ({
						ledger,
						transactionResultSetHash
					}))
				}
			}
		}
	};
}

describe('compact category serialized size guard', () => {
	it.each([{ hashes: [] }, { hashes: ['a'] }])(
		'keeps empty and small nonempty facts unchanged: %j',
		({ hashes }) => {
			const value = prepared(hashes);
			expect(contentFactsForStorage(value, true)).toBe(
				value.progress.verificationFacts
			);
		}
	);

	it('deduplicates a large 64-ledger category only when smaller', () => {
		const value = prepared(Array.from({ length: 64 }, () => 'a'.repeat(44)));
		const compact = contentFactsForStorage(value, true);
		expect(compact).toHaveProperty(
			'contentReference.artifactId',
			value.reuse!.artifactId
		);
		expect(bytes(compact)).toBeLessThan(
			bytes(value.progress.verificationFacts) / 10
		);
	});

	it('keeps full facts when the serialized sizes are exactly equal', () => {
		const compact = contentFactsForStorage(prepared(['a'.repeat(2000)]), true);
		const overhead =
			bytes(compact) - bytes(prepared(['']).progress.verificationFacts);
		const value = prepared(['a'.repeat(overhead)]);
		expect(bytes(value.progress.verificationFacts)).toBe(bytes(compact));
		expect(contentFactsForStorage(value, true)).toBe(
			value.progress.verificationFacts
		);
	});

	it('compares UTF-8 bytes rather than JavaScript character counts', () => {
		const compact = contentFactsForStorage(prepared(['a'.repeat(2000)]), true);
		const overhead =
			bytes(compact) - bytes(prepared(['']).progress.verificationFacts);
		const value = prepared(['é'.repeat(Math.floor(overhead / 2) + 1)]);
		expect(
			JSON.stringify(value.progress.verificationFacts).length
		).toBeLessThan(JSON.stringify(compact).length);
		expect(bytes(value.progress.verificationFacts)).toBeGreaterThan(
			bytes(compact)
		);
		expect(contentFactsForStorage(value, true)).toEqual(compact);
	});
});

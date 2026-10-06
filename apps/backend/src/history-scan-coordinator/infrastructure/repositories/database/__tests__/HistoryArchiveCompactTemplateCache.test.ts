import {
	HistoryArchiveCompactTemplateCache,
	bindCompactTemplate
} from '../HistoryArchiveCompactTemplateCache.js';
import type { PreparedContentCompletion } from '../HistoryArchiveContentReuseWrite.js';
import { contentFactsForStorage } from '../HistoryArchiveCompactContentFacts.js';

function prepared(
	id = 'artifact-one',
	sourceUrl = 'https://root.example/file'
): PreparedContentCompletion {
	return {
		reuse: {
			artifactId: id,
			sourceObjectRemoteId: 'source',
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
				ledgerCategory: {
					entryCount: 64,
					headerHashesVerified: true,
					sourceUrl,
					ledgers: Array.from({ length: 64 }, (_, ledger) => ({
						ledger,
						bucketListHash: 'b'.repeat(64),
						ledgerHeaderHash: 'c'.repeat(64),
						previousLedgerHeaderHash: 'd'.repeat(64),
						protocolVersion: 29,
						transactionResultSetHash: 'e'.repeat(64),
						transactionSetHash: 'f'.repeat(64)
					}))
				}
			}
		}
	};
}

describe('bounded immutable compact template cache', () => {
	it('bounds retained serialized bytes and entries with LRU eviction', () => {
		const cache = new HistoryArchiveCompactTemplateCache(2048, 2);
		const first = prepared('one');
		const second = prepared('two');
		const third = prepared('three');
		cache.put(first);
		cache.put(second);
		expect(cache.get(first.reuse!, 1)).toBeDefined();
		cache.put(third);
		expect(cache.size).toBeLessThanOrEqual(2);
		expect(cache.byteLength).toBeLessThanOrEqual(2048);
		expect(cache.get(second.reuse!, 1)).toBeUndefined();
		cache.delete('one');
		cache.delete('three');
		expect(cache.byteLength).toBe(0);
	});
	it('declines an entry larger than its entire budget', () => {
		const cache = new HistoryArchiveCompactTemplateCache(10, 2);
		cache.put(prepared());
		expect(cache.size).toBe(0);
		expect(cache.byteLength).toBe(0);
	});
	it.each([
		'sourceObjectRemoteId',
		'contentDigest',
		'contentRepresentation',
		'derivationVersion'
	] as const)('evicts a known artifact on %s mismatch', (field) => {
		const cache = new HistoryArchiveCompactTemplateCache();
		const item = prepared();
		cache.put(item);
		const mismatched = { ...item.reuse! };
		Object.assign(mismatched, {
			[field]: field === 'derivationVersion' ? 2 : 'different'
		});
		expect(cache.get(mismatched, 1)).toBeUndefined();
		expect(cache.size).toBe(0);
	});
	it('rebinds Unicode URL and attempt without shared mutable objects or stored arrays', () => {
		const cache = new HistoryArchiveCompactTemplateCache();
		const item = prepared();
		cache.put(item);
		const template = cache.get(item.reuse!, 999)!;
		expect(template.serialized).not.toContain('ledgerHeaderHash');
		const rebound = bindCompactTemplate(template, 'https://例.example/é', 999);
		expect(rebound).toEqual(
			contentFactsForStorage(
				{
					...item,
					progress: {
						...item.progress,
						claimAttempt: 999,
						verificationFacts: prepared('artifact-one', 'https://例.example/é')
							.progress.verificationFacts
					}
				},
				true
			)
		);
		Object.assign(rebound, { content: null });
		expect(bindCompactTemplate(template, '', 1).content.digest).toBe(
			'a'.repeat(64)
		);
	});
	it('keeps small empty categories inline instead of caching a larger reference', () => {
		const cache = new HistoryArchiveCompactTemplateCache();
		const item = prepared();
		const small: PreparedContentCompletion = {
			...item,
			progress: {
				claimAttempt: 1,
				verificationFacts: {
					content: item.progress.verificationFacts!.content,
					transactionsCategory: {
						entryCount: 0,
						ledgers: [],
						sourceUrl: 'https://root.example/file'
					}
				}
			}
		};
		expect(contentFactsForStorage(small, true)).toBe(
			small.progress.verificationFacts
		);
		cache.put(small);
		expect(cache.size).toBe(0);
	});
});

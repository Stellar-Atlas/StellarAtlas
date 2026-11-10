import type {
	BoundExactClassicObservation,
	ExactClassicSelection
} from '../ExactClassicObservation.js';
import { ExactClassicObservationError } from '../ExactClassicObservation.js';
import {
	selectExactClassicObservation,
	MAXIMUM_EXACT_OBSERVATIONS,
	MAXIMUM_EXACT_IMPORTS
} from '../SelectExactClassicObservation.js';

import {
	account,
	issuer,
	source,
	row,
	selection
} from './ExactClassicObservationFixtures.js';

describe('pure exact classic observation selection', () => {
	it('preserves large atomic strings and disclaims current-chain/snapshot authority', () => {
		const result = selectExactClassicObservation(selection());
		expect(result).toMatchObject({
			state: 'present',
			currentChainState: false,
			snapshotPinned: false,
			observation: {
				balanceRaw: '9223372036854775807',
				buyingLiabilitiesRaw: '9007199254740993',
				sellingLiabilitiesRaw: '0',
				precision: 'exact-atomic-observation',
				scale: 7
			}
		});
		expect(JSON.parse(JSON.stringify(result)).observation.balanceRaw).toBe(
			'9223372036854775807'
		);
	});

	it('supports a separately validated classic issued identity', () => {
		const asset = { kind: 'issued' as const, code: 'USD', issuer };
		const input = selection([row({ asset })]);
		expect(
			selectExactClassicObservation({
				...input,
				scope: { ...input.scope, asset }
			}).scope.asset
		).toEqual(asset);
	});

	it('distinguishes real zero, no observation in a complete interval, removal and restore', () => {
		expect(
			selectExactClassicObservation(selection([row({ balanceRaw: '0' })]))
		).toMatchObject({ state: 'present', observation: { balanceRaw: '0' } });
		expect(selectExactClassicObservation(selection([]))).toMatchObject({
			state: 'no-observation',
			observation: null
		});
		const removed = row({ changeKind: 'removed', deleted: true });
		expect(selectExactClassicObservation(selection([removed]))).toMatchObject({
			state: 'deleted',
			observation: { deleted: true, balanceRaw: removed.balanceRaw }
		});
		const restored = row({
			ledgerSequence: '51',
			changeKind: 'restored',
			balanceRaw: '1'
		});
		expect(
			selectExactClassicObservation(selection([restored, removed]))
		).toMatchObject({
			state: 'present',
			observation: { changeKind: 'restored', balanceRaw: '1' }
		});
	});

	it('orders metadata after all fees, even when a fee has a larger transaction index', () => {
		const fee = row({ reason: 'fee', transactionIndex: '9', balanceRaw: '9' });
		const metadata = row({
			reason: 'operation',
			operationIndex: '1',
			transactionIndex: '1',
			changeIndex: '2',
			balanceRaw: '8'
		});
		// Naive transaction-desc selection picks fee=9, which is not latest.
		expect(
			selectExactClassicObservation(selection([metadata, fee])).observation
				?.balanceRaw
		).toBe('8');
	});

	it('orders refunds after metadata and zero-transaction-index upgrades last', () => {
		const metadata = row({ transactionIndex: '9', balanceRaw: '9' });
		const refund = row({
			reason: 'fee_refund',
			transactionIndex: '1',
			changeIndex: '3',
			balanceRaw: '8'
		});
		const upgrade = row({
			reason: 'upgrade',
			transactionIndex: '0',
			upgradeIndex: '1',
			changeIndex: '1',
			balanceRaw: '7'
		});
		expect(
			selectExactClassicObservation(selection([refund, metadata])).observation
				?.balanceRaw
		).toBe('8');
		expect(
			selectExactClassicObservation(selection([metadata, upgrade, refund]))
				.observation?.balanceRaw
		).toBe('7');
	});

	it('orders ledger before phase and respects metadata/change and global upgrade order', () => {
		const a = row({
			reason: 'upgrade',
			transactionIndex: '0',
			upgradeIndex: '1',
			changeIndex: '2',
			balanceRaw: '2'
		});
		const b = row({
			reason: 'upgrade',
			transactionIndex: '0',
			upgradeIndex: '2',
			changeIndex: '4',
			balanceRaw: '4'
		});
		expect(
			selectExactClassicObservation(selection([b, a])).observation?.balanceRaw
		).toBe('4');
		expect(
			selectExactClassicObservation(
				selection([
					b,
					row({ ledgerSequence: '51', reason: 'fee', balanceRaw: '5' })
				])
			).observation?.balanceRaw
		).toBe('5');
		expect(
			selectExactClassicObservation(
				selection([
					row({ changeIndex: '10', balanceRaw: '10' }),
					row({ changeIndex: '9' })
				])
			).observation?.balanceRaw
		).toBe('10');
	});

	it('deduplicates only identical bound evidence and never uses batch IDs as a tiebreaker', () => {
		const input = selection([row(), row()]);
		expect(
			selectExactClassicObservation({
				...input,
				coverage: { ...input.coverage, expectedDistinctObservations: 1 }
			})
		).toMatchObject({ state: 'present', distinctObservations: 1 });
		const otherBatch = '00000000-0000-0000-0000-000000000002';
		expect(() =>
			selectExactClassicObservation({
				...selection([row(), row({ batchId: otherBatch })]),
				imports: [source, { ...source, batchId: otherBatch }]
			})
		).toThrow('Contradictory');
		for (const value of [
			row({ balanceRaw: '1' }),
			row({ rowDigest: 'd'.repeat(64) }),
			row({ changeKind: 'created' })
		]) {
			expect(() =>
				selectExactClassicObservation(selection([row(), value]))
			).toThrow(ExactClassicObservationError);
		}
	});

	it.each(['partial', 'unknown'] as const)(
		'never reports amounts under %s coverage',
		(status) => {
			const input = selection();
			expect(
				selectExactClassicObservation({
					...input,
					coverage: { ...input.coverage, status }
				})
			).toMatchObject({
				state: 'incomplete',
				observation: null,
				incompleteReasons: ['coverage']
			});
		}
	);

	it('treats clipping, unknown/mismatched counts, missing imports and range gaps as incomplete', () => {
		const input = selection();
		for (const coverage of [
			{ ...input.coverage, truncated: true },
			{ ...input.coverage, expectedDistinctObservations: null },
			{ ...input.coverage, expectedDistinctObservations: 2 },
			{ ...input.coverage, expectedDistinctObservations: 129 }
		]) {
			expect(
				selectExactClassicObservation({ ...input, coverage })
			).toMatchObject({ state: 'incomplete', observation: null });
		}
		expect(
			selectExactClassicObservation({ ...selection([]), imports: [] }).state
		).toBe('incomplete');
		expect(
			selectExactClassicObservation({
				...input,
				imports: [{ ...source, lastLedger: '50' }]
			}).state
		).toBe('incomplete');
	});

	it.each([
		{ status: 'pending' as const },
		{ status: 'failed' as const },
		{ visibility: 'hidden' as const },
		{ verifiedSourceDigest: null }
	])(
		'withholds amounts for incomplete/unverified/hidden imports: %j',
		(change) => {
			expect(
				selectExactClassicObservation({
					...selection(),
					imports: [{ ...source, ...change }]
				})
			).toMatchObject({
				state: 'incomplete',
				observation: null,
				incompleteReasons: ['imports']
			});
		}
	);

	it('accepts contiguous declared import ranges, but never fills a gap', () => {
		const other = {
			...source,
			batchId: '00000000-0000-0000-0000-000000000002',
			firstLedger: '51'
		};
		expect(
			selectExactClassicObservation({
				...selection(),
				imports: [{ ...source, lastLedger: '50' }, other]
			}).state
		).toBe('present');
		expect(
			selectExactClassicObservation({
				...selection(),
				imports: [
					{ ...source, lastLedger: '50' },
					{ ...other, firstLedger: '52' }
				]
			}).state
		).toBe('incomplete');
	});

	it.each([
		'-1',
		'9223372036854775808',
		'9007199254740993.0',
		'1e7',
		'01',
		' 1',
		'',
		'9'.repeat(1000)
	])('rejects an invalid classic raw quantity: %s', (balanceRaw) => {
		expect(() =>
			selectExactClassicObservation(selection([row({ balanceRaw })]))
		).toThrow(ExactClassicObservationError);
	});

	it.each(['buyingLiabilitiesRaw', 'sellingLiabilitiesRaw'] as const)(
		'validates the %s amount role too',
		(key) => {
			expect(() =>
				selectExactClassicObservation(selection([row({ [key]: '-1' })]))
			).toThrow(ExactClassicObservationError);
		}
	);

	it.each([
		{ reason: 'unknown' },
		{ reason: '__proto__' },
		{ transactionIndex: '0' },
		{ changeIndex: '0' },
		{ changeIndex: '4294967296' },
		{ changeIndex: '01' },
		{ operationIndex: '1' },
		{ reason: 'operation', operationIndex: null },
		{ reason: 'upgrade', transactionIndex: '0', upgradeIndex: null },
		{ reason: 'upgrade', upgradeIndex: '1' },
		{ upgradeIndex: '1' },
		{ changeKind: 'removed', deleted: false },
		{ changeKind: 'restored', deleted: true }
	])('rejects contradictory reason/index/deletion provenance: %j', (values) => {
		expect(() =>
			selectExactClassicObservation(
				selection([row(values as Partial<BoundExactClassicObservation>)])
			)
		).toThrow(ExactClassicObservationError);
	});

	it('rejects reversed upgrade, operation and within-transaction phase indices', () => {
		expect(() =>
			selectExactClassicObservation(
				selection([
					row({
						reason: 'upgrade',
						transactionIndex: '0',
						upgradeIndex: '2',
						changeIndex: '1'
					}),
					row({
						reason: 'upgrade',
						transactionIndex: '0',
						upgradeIndex: '1',
						changeIndex: '2'
					})
				])
			)
		).toThrow('upgrade order');
		expect(() =>
			selectExactClassicObservation(
				selection([
					row({ reason: 'fee', changeIndex: '3' }),
					row({ changeIndex: '2' })
				])
			)
		).toThrow('phase change order');
		expect(() =>
			selectExactClassicObservation(
				selection([
					row({ reason: 'operation', operationIndex: '2' }),
					row({ reason: 'operation', operationIndex: '1', changeIndex: '2' })
				])
			)
		).toThrow('operation order');
	});

	it('rejects network/account/asset/source mixing consistently', () => {
		for (const values of [
			{ networkHash: 'd'.repeat(64) },
			{ account: issuer },
			{ asset: { kind: 'issued', code: 'USD', issuer } },
			{ sourceDigest: 'd'.repeat(64) },
			{ batchId: '00000000-0000-0000-0000-000000000002' },
			{ rowDigest: 'not-a-digest' },
			{ ledgerSequence: '101' }
		]) {
			expect(() =>
				selectExactClassicObservation(
					selection([row(values as Partial<BoundExactClassicObservation>)])
				)
			).toThrow(ExactClassicObservationError);
		}
		expect(() =>
			selectExactClassicObservation({
				...selection(),
				imports: [{ ...source, networkHash: 'd'.repeat(64) }]
			})
		).toThrow('network');
		expect(() =>
			selectExactClassicObservation({
				...selection(),
				imports: [{ ...source, verifiedSourceDigest: 'd'.repeat(64) }]
			})
		).toThrow('content');
		expect(() =>
			selectExactClassicObservation({
				...selection(),
				imports: [source, { ...source, visibility: 'hidden' }]
			})
		).toThrow('Contradictory');
	});

	it('rejects unsupported domains, invalid identity, unsafe counts and oversized lists', () => {
		for (const value of [
			{ kind: 'pool-share' },
			{ kind: 'contract' },
			{ kind: 'reserve' },
			{ kind: 'issued', code: 'USD', issuer: 'GBAD' }
		]) {
			const input = selection();
			expect(() =>
				selectExactClassicObservation({
					...input,
					scope: {
						...input.scope,
						asset: value as ExactClassicSelection['scope']['asset']
					}
				})
			).toThrow(ExactClassicObservationError);
		}
		expect(() =>
			selectExactClassicObservation({
				...selection(),
				observations: Array.from(
					{ length: MAXIMUM_EXACT_OBSERVATIONS + 1 },
					() => row()
				)
			})
		).toThrow('input bound');
		expect(() =>
			selectExactClassicObservation({
				...selection(),
				imports: Array.from({ length: MAXIMUM_EXACT_IMPORTS + 1 }, () => source)
			})
		).toThrow('input bound');
		expect(() =>
			selectExactClassicObservation({
				...selection(),
				coverage: {
					status: 'complete',
					truncated: false,
					expectedDistinctObservations: Number.MAX_SAFE_INTEGER + 1
				}
			})
		).toThrow('coverage count');
	});

	it('accepts an exactly complete maximum-size input without clipping', () => {
		const rows = Array.from({ length: MAXIMUM_EXACT_OBSERVATIONS }, (_, i) =>
			row({ changeIndex: String(i + 1) })
		);
		expect(selectExactClassicObservation(selection(rows))).toMatchObject({
			state: 'present',
			distinctObservations: 128,
			observation: { changeIndex: '128' }
		});
	});

	it('detaches and freezes returned scope/provenance from caller objects', () => {
		const input = selection();
		const before = JSON.stringify(input),
			result = selectExactClassicObservation(input);
		expect(JSON.stringify(input)).toBe(before);
		expect(result.scope).not.toBe(input.scope);
		expect(result.scope.asset).not.toBe(input.scope.asset);
		expect(result.observation?.source).not.toBe(source);
		expect(Object.isFrozen(result.observation)).toBe(true);
		expect(Object.isFrozen(result.observation?.source)).toBe(true);
		expect(Object.isFrozen(result.incompleteReasons)).toBe(true);
		Object.assign(input.scope, { account: issuer });
		Object.assign(input.observations[0], { balanceRaw: '0' });
		expect(result.scope.account).toBe(account);
		expect(result.observation?.balanceRaw).toBe('9223372036854775807');
	});
});

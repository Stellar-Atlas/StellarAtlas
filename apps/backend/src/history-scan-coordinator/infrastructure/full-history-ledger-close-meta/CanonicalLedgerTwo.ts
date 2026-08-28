import { createHash } from 'node:crypto';
import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSequence,
	fullHistoryLedgerCloseMetaSha256Digest
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerCloseMetaSourceRegistration } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaManifest.js';
import type { FullHistoryLedgerCloseMetaSourceObject } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaSource.js';
import { StellarLedgerCloseMetaBatchDecoder } from './StellarLedgerCloseMetaBatchDecoder.js';

const publicNetworkPassphrase =
	'Public Global Stellar Network ; September 2015';
const ledgerOneHash =
	'39c2a3cd4141b2853e70d84601faa44744660334b48f3228e0309342e3f4eb48';
const ledgerTwoHash =
	'fe0f6bea5f341344fdb5bc6fc4ad719dd63071d9203e9a1e7f17c68ea1ecebde';
const compressedSha256 =
	'7e564722f363824fca0192dee1f91012eebafbd3fae63c70a9302457a4aa590d';
const xdrSha256 =
	'74b6b74707503b2e86196e1faa71e8f75c7a5f1f00a199f446b49e8c82597228';
const artifactBase64 =
	'KLUv/WDYAJ0HAIQMAAAAAgEAAAAA/g9r6l80E0T9tbxvxK1xndYwcdkgPpoefxfGjqHs694AAAABOcKjzUFBsoU+cNhGAfqkR0RmAzS0jzIo4DCTQuP060jNSOv9+gXdm7VKeXuAhRdQaqGhQkba3NQps2g8CwWGkVYMEf4IAwAAAfTfP2GYBKkv20BXGS3EPddI6neK3FK8SYzoBSTAFLgRGZHZCAfQ3duQ6cSd6a4FXvcp9MvZ8w42s1xTWldEoiQyDeC2s6dkAGQF9eEAAgAAAAAQAKAAAuysuZMZ8bVwCAAFcyA0DgaMYc1R+y/Ldo8r1t3DKV3DMrsuCw==';
const historyRoot = 'https://history.stellar.org/prd/core-live/core_live_001';
const checkpointEvidence =
	'sdf-checkpoint-63:' +
	'ledger=448f0c10db4322efcd28a275811c20be96dda2a9b69f38a09afd0cbb46eee357;' +
	'transactions=73cf0b074326b78b1a2eb0981f4338bde4219a2b83a6f5b4d3c6c685b4e1932e;' +
	'results=f82f3c6d457541442b900dcd2997a9dd628b2cd0168f511b0cb82a4f122621be;' +
	'reconstruction=stellar-atlas-v1';

export interface CanonicalLedgerTwoBootstrap {
	readonly object: FullHistoryLedgerCloseMetaSourceObject;
	readonly registration: FullHistoryLedgerCloseMetaSourceRegistration;
}

export function canonicalLedgerTwoBootstrap(
	networkPassphrase: string,
	observedAt = new Date()
): CanonicalLedgerTwoBootstrap {
	if (networkPassphrase !== publicNetworkPassphrase) {
		throw new Error('Canonical ledger-two bootstrap is pubnet-only');
	}
	if (Number.isNaN(observedAt.getTime())) {
		throw new Error('Ledger-two observation timestamp is invalid');
	}
	const bytes = Buffer.from(artifactBase64, 'base64');
	assertCanonicalLedgerTwo(bytes);
	const config = Object.freeze({
		batchesPerPartition: 1,
		compression: 'zstd' as const,
		ledgersPerBatch: 1,
		networkPassphrase,
		version: 'stellar-atlas-ledger-two-reconstruction-v1'
	});
	const configBytes = Buffer.from(JSON.stringify(config), 'utf8');
	const object = Object.freeze({
		bytes,
		identity: Object.freeze({
			generation: checkpointEvidence,
			objectKey: 'reconstruction/pubnet/ledger-2-from-checkpoint-63.xdr.zst',
			sourceUri: historyRoot
		})
	});
	return Object.freeze({
		object,
		registration: Object.freeze({
			config,
			configDigest: digest(configBytes),
			configObject: Object.freeze({
				bytes: configBytes,
				identity: Object.freeze({
					generation: 'sdf-checkpoint-63-reconstruction-v1',
					objectKey: 'history/00/00/00/history-0000003f.json',
					sourceUri: historyRoot
				})
			}),
			firstAvailableLedger: fullHistoryLedgerCloseMetaSequence(2),
			networkPassphraseHash: digest(Buffer.from(networkPassphrase, 'utf8')),
			observedAt,
			source: Object.freeze({
				ledgersPath: 'reconstruction/pubnet',
				sourceUri: historyRoot
			})
		})
	});
}

function assertCanonicalLedgerTwo(bytes: Buffer): void {
	const decoded = new StellarLedgerCloseMetaBatchDecoder({
		maximumCompressedBytes: 1_024,
		maximumUncompressedBytes: 4_096
	}).decode({
		compressedPayload: bytes,
		expectedRange: fullHistoryLedgerCloseMetaRange(2, 2)
	});
	if (
		decoded.compressedSha256 !== compressedSha256 ||
		decoded.xdrSha256 !== xdrSha256 ||
		decoded.xdrByteCount !== 472 ||
		decoded.ledgers.length !== 1
	) {
		throw new Error('Canonical ledger-two artifact digest is invalid');
	}
	const meta = decoded.ledgers[0]!.ledgerCloseMeta;
	if (meta.switch() !== 0) {
		throw new Error('Canonical ledger two must use LedgerCloseMeta v0');
	}
	const value = meta.v0();
	const ledgerHeader = value.ledgerHeader();
	if (
		Buffer.from(ledgerHeader.hash()).toString('hex') !== ledgerTwoHash ||
		Buffer.from(ledgerHeader.header().previousLedgerHash()).toString('hex') !==
			ledgerOneHash ||
		ledgerHeader.header().ledgerSeq() !== 2 ||
		value.txSet().txes().length !== 0 ||
		value.txProcessing().length !== 0 ||
		value.upgradesProcessing().length !== 2 ||
		value.scpInfo().length !== 0
	) {
		throw new Error('Canonical ledger-two contents are invalid');
	}
}

function digest(value: Uint8Array) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		createHash('sha256').update(value).digest('hex')
	);
}

'use client';

import { ExplorerLink as Link } from './explorer-investigation';
import { useEffect, useState } from 'react';
import {
	entityText,
	recordValue,
	requestExplorerJson,
	type EntityRecord
} from '../../api/explorer-analytics';
import styles from './explorer-pool-table.module.css';

type Metadata = Readonly<Record<string, EntityRecord>>;
const cache = new Map<string, EntityRecord>();

/** One bounded metadata request per group; never one network request per table cell. */
export function usePairMetadata(
	rows: readonly EntityRecord[],
	fields = ['assetA', 'assetB']
): Metadata {
	const ids = [
		...new Set(
			rows
				.flatMap((row) =>
					fields.map((field) => entityText(recordValue(row[field]), 'id'))
				)
				.filter(Boolean)
		)
	];
	const key = JSON.stringify(ids);
	const [metadata, setMetadata] = useState<Metadata>({});
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		const abort = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const publish = () =>
			setMetadata(
				Object.fromEntries(
					ids.filter((id) => cache.has(id)).map((id) => [id, cache.get(id)!])
				)
			);
		publish();
		const pending = ids.filter(
			(id) => !cache.has(id) || cache.get(id)?.logoStatus === 'pending'
		);
		let next = 0;
		void Promise.all(
			Array.from(
				{ length: Math.min(2, Math.ceil(pending.length / 16)) },
				async () => {
					while (next < pending.length && !abort.signal.aborted) {
						const group = pending.slice(next, (next += 16));
						try {
							const result = recordValue(
								await requestExplorerJson(
									'/v1/asset-metadata?' +
										new URLSearchParams({ assets: JSON.stringify(group) }),
									abort.signal
								)
							);
							for (const asset of (Array.isArray(result.assets)
								? result.assets
								: []
							).map(recordValue)) {
								const id = entityText(asset, 'id');
								if (group.includes(id)) cache.set(id, asset);
							}
							while (cache.size > 256) cache.delete(cache.keys().next().value!);
							if (!abort.signal.aborted) publish();
						} catch {
							/* Metadata is optional; identities remain usable without a logo. */
						}
					}
				}
			)
		).then(() => {
			if (
				!abort.signal.aborted &&
				revision < 2 &&
				ids.some((id) => cache.get(id)?.logoStatus === 'pending')
			)
				timer = setTimeout(
					() => setRevision((value) => value + 1),
					revision === 0 ? 5_000 : 20_000
				);
		});
		return () => {
			abort.abort();
			if (timer) clearTimeout(timer);
		};
		// The serialized, bounded identity selection is the dependency, not row object identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, revision]);
	return metadata;
}

export function ExplorerAssetPair({
	a,
	b,
	metadata
}: {
	readonly a: unknown;
	readonly b: unknown;
	readonly metadata: Metadata;
}): React.JSX.Element {
	return (
		<div className={styles.pair}>
			<ExplorerPairAsset value={a} metadata={metadata} />
			<span className={styles.separator}>/</span>
			<ExplorerPairAsset value={b} metadata={metadata} />
		</div>
	);
}

export function ExplorerPairAsset({
	value,
	metadata
}: {
	readonly value: unknown;
	readonly metadata: Metadata;
}): React.JSX.Element {
	const asset = recordValue(value),
		id = entityText(asset, 'id');
	const symbol = id === 'native' ? 'XLM' : entityText(asset, 'code') || 'Asset';
	const [broken, setBroken] = useState(false);
	const logo = entityText(metadata[id] ?? {}, 'logoUrl');
	return (
		<Link
			className={styles.asset}
			href={'/explorer/assets/' + encodeURIComponent(id)}
			title={id}
		>
			{logo && !broken ? (
				<img
					src={logo}
					alt=""
					width={24}
					height={24}
					loading="lazy"
					onError={() => setBroken(true)}
				/>
			) : (
				<span className={styles.monogram} aria-hidden="true">
					{symbol.slice(0, 1)}
				</span>
			)}
			<strong>{symbol}</strong>
		</Link>
	);
}

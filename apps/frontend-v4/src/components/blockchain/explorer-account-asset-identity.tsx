'use client';

import { useState } from 'react';
import { buildEntityHref, entityText, type EntityRecord } from '../../api/explorer-analytics';
import type { ClassicAssetIdentity } from '../../api/explorer-current-account';
import { assetMetadataCache } from './explorer-asset-metadata-cache';
import { ExplorerLink as Link } from './explorer-investigation';
import styles from './explorer-account-assets.module.css';

export function AccountAssetIdentity({ asset, metadata }: {
	readonly asset: ClassicAssetIdentity;
	readonly metadata?: EntityRecord;
}): React.JSX.Element {
	const known = metadata ?? assetMetadataCache.get(asset.id) ?? {};
	const logo = entityText(known, 'logoUrl');
	const cachedLogo = /^\/v1\/asset-logos\/[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/.test(logo) ? logo : null;
	const name = entityText(known, 'name').trim();
	const [brokenLogo, setBrokenLogo] = useState<string | null>(null);
	return <div className={styles.identity}>
		{cachedLogo && cachedLogo !== brokenLogo
			? <img src={cachedLogo} width={28} height={28} alt="" title="Issuer-provided logo" loading="lazy" onError={() => setBrokenLogo(cachedLogo)} />
			: <span className={styles.mark} aria-hidden="true">{asset.code.slice(0, 1)}</span>}
		<div>
			<Link href={buildEntityHref('assets', asset.id)}><strong>{asset.code}</strong></Link>
			{name && name !== asset.code && <small>Issuer name: {name}</small>}
			<small><Link href={buildEntityHref('accounts', asset.issuer)} aria-label={`Issuer ${asset.issuer}`}>{asset.issuer}</Link></small>
		</div>
	</div>;
}

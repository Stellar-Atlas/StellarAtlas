'use client';

import { LocalDateTime } from '../local-date-time';
import {
	metadataFieldLabel,
	safeMetadataUrl
} from './explorer-metadata-fields';
import type { Metadata } from './explorer-asset-types';
import ui from './explorer-asset-workspace.module.css';

/** Publisher text is data, never an asset description authored by StellarAtlas. */
export function ParsedIssuerMetadata({
	metadata
}: {
	metadata?: Metadata;
}): React.JSX.Element | null {
	if (!metadata) return null;
	const fields: Record<string, string> = { ...metadata.fields };
	if (metadata.name) fields.name = metadata.name;
	if (metadata.description) fields.desc = metadata.description;
	if (typeof metadata.organization === 'object') {
		for (const [key, value] of Object.entries(metadata.organization))
			fields[key.startsWith('ORG_') ? key : 'organization.' + key] = value;
	}
	if (typeof metadata.organization === 'string')
		fields.ORG_NAME = metadata.organization;
	const entries = Object.entries(fields)
		.filter(([, value]) => value !== '')
		.sort(([a], [b]) => a.localeCompare(b));
	return (
		<section
			className={ui.issuerMetadata}
			aria-label="Issuer-published metadata"
		>
			<h3>
				Issuer-published metadata <span>stellar.toml</span>
			</h3>
			<div className={ui.metadataSource}>
				<p>
					Issuer-published claims. Not verified or endorsed by StellarAtlas.
				</p>
				{metadata.tomlUrl?.startsWith('https://') && (
					<a href={metadata.tomlUrl} target="_blank" rel="noreferrer">
						{metadata.tomlUrl}
					</a>
				)}
				{metadata.fetchedAt && (
					<span>
						Fetched <LocalDateTime dateTime={metadata.fetchedAt} />
					</span>
				)}
				{metadata.error && <p role="alert">{metadata.error}</p>}
			</div>
			{entries.length > 0 && (
				<dl className={ui.metadataFields}>
					{entries.map(([key, value]) => (
						<div key={key}>
							<dt title={key}>{metadataFieldLabel(key)}</dt>
							<dd>
								{safeMetadataUrl(value) ? (
									<a
										href={safeMetadataUrl(value) ?? undefined}
										target="_blank"
										rel="noreferrer"
									>
										{value}
									</a>
								) : (
									value
								)}
							</dd>
						</div>
					))}
				</dl>
			)}
		</section>
	);
}

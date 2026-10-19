const assetLabels: Readonly<Record<string, string>> = {
	code: 'Asset code',
	issuer: 'Issuer',
	name: 'Published name',
	desc: 'Description',
	image: 'Logo URL',
	display_decimals: 'Display decimals',
	status: 'Published status',
	anchor_asset_type: 'Claimed asset class',
	anchor_asset: 'Claimed underlying asset',
	redemption_instructions: 'Redemption claim',
	conditions: 'Published conditions'
};

const organizationLabels: Readonly<Record<string, string>> = {
	name: 'Organization name',
	description: 'Organization description',
	url: 'Website',
	github: 'GitHub',
	twitter: 'Social handle',
	logo: 'Organization logo URL'
};

export function metadataFieldLabel(key: string): string {
	const assetLabel = assetLabels[key];
	if (assetLabel !== undefined) return assetLabel;

	let organizationKey: string | undefined;
	if (key.startsWith('organization.documentation.')) {
		organizationKey = key.slice('organization.documentation.'.length);
	} else if (key.startsWith('ORG_')) {
		organizationKey = key.slice('ORG_'.length);
	}

	if (organizationKey !== undefined) {
		const organizationLabel = organizationLabels[organizationKey.toLowerCase()];
		if (organizationLabel !== undefined) return organizationLabel;
	}

	const fallback = key.replace(/[_.]/g, ' ');
	return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

export function safeMetadataUrl(value: string): string | null {
	try {
		const url = new URL(value);
		const authority = /^https:\/\/([^/?#]*)/i.exec(value)?.[1];
		if (
			url.protocol !== 'https:' ||
			url.hostname.length === 0 ||
			url.username ||
			url.password ||
			authority === undefined ||
			authority.includes('@')
		) {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

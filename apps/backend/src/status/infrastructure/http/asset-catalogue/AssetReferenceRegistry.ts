export interface AssetReferenceInfo {
	readonly referenceIdentity: string;
	readonly source: string;
}

const approvedReferences = new Map<string, AssetReferenceInfo>([
	[
		'KALE:GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE',
		{
			referenceIdentity:
				'KALE:GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE',
			source: 'https://github.com/kalepail/kale-sc'
		}
	]
]);

export function assetReferenceInfo(assetId: string): AssetReferenceInfo | null {
	return approvedReferences.get(assetId) ?? null;
}

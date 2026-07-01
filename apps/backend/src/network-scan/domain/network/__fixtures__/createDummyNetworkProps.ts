import { NetworkProps } from '../Network.js';
import { OverlayVersionRange } from '../OverlayVersionRange.js';
import { StellarCoreVersion } from '../StellarCoreVersion.js';
import { createDummyNetworkQuorumSetConfiguration } from './createDummyNetworkQuorumSetConfiguration.js';

export function createDummyNetworkProps(): NetworkProps {
	const overlayVersionRangeOrError = OverlayVersionRange.create(1, 2);
	if (overlayVersionRangeOrError.isErr())
		throw overlayVersionRangeOrError.error;
	const stellarCoreVersionStringOrError = StellarCoreVersion.create('1.0.0');
	if (stellarCoreVersionStringOrError.isErr())
		throw stellarCoreVersionStringOrError.error;
	const quorumSet = createDummyNetworkQuorumSetConfiguration();

	return {
		name: 'my test network',
		maxLedgerVersion: 1,
		overlayVersionRange: overlayVersionRangeOrError.value,
		stellarCoreVersion: stellarCoreVersionStringOrError.value,
		quorumSetConfiguration: quorumSet
	};
}

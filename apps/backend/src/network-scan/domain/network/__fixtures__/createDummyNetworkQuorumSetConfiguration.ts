import { NetworkQuorumSetConfiguration } from '../NetworkQuorumSetConfiguration.js';
import { createDummyPublicKey } from '../../node/__fixtures__/createDummyPublicKey.js';

export function createDummyNetworkQuorumSetConfiguration() {
	const publicKey1 = createDummyPublicKey();
	const publicKey2 = createDummyPublicKey();

	const innerQuorumSet = new NetworkQuorumSetConfiguration(
		1,
		[publicKey1, publicKey2],
		[]
	);
	return new NetworkQuorumSetConfiguration(
		2,
		[publicKey1, publicKey2],
		[innerQuorumSet]
	);
}

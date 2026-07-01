import { xdr } from '@stellar/stellar-sdk';

export function createDummyDontHaveMessage() {
	const dontHave = new xdr.DontHave({
		reqHash: Buffer.alloc(32),
		type: xdr.MessageType.getScpQuorumset()
	});
	return xdr.StellarMessage.dontHave(dontHave);
}

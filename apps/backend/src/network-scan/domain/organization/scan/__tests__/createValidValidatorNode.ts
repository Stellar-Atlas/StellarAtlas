import { StrKey } from '@stellar/stellar-sdk';
import Node from '../../../node/Node.js';
import PublicKey from '../../../node/PublicKey.js';

export function createValidPublicKeyString(seed = 1): string {
	return StrKey.encodeEd25519PublicKey(Buffer.alloc(32, seed));
}

export function createValidValidatorNode(time = new Date(), seed = 1): Node {
	const publicKey = PublicKey.create(createValidPublicKeyString(seed));
	if (publicKey.isErr()) throw publicKey.error;
	return Node.create(time, publicKey.value, { ip: 'localhost', port: 3000 });
}

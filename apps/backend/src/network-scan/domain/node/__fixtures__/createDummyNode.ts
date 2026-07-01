import { createDummyPublicKey } from './createDummyPublicKey.js';
import Node from '../Node.js';

export function createDummyNode(
	ip?: string,
	port?: number,
	time = new Date()
): Node {
	return Node.create(time, createDummyPublicKey(), {
		ip: ip ?? 'localhost',
		port: port ?? 3000
	});
}

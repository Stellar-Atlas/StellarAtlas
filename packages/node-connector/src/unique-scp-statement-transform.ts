import { Transform, TransformCallback } from 'stream';
import { LRUCache } from 'lru-cache';
import { hash, Networks, xdr } from '@stellar/stellar-sdk';
import StellarMessage = xdr.StellarMessage;
import MessageType = xdr.MessageType;
import { verifySCPEnvelopeSignature } from './stellar-message-service.js';

export class UniqueSCPStatementTransform extends Transform {
	protected cache = new LRUCache<string, number>({ max: 5000 });

	constructor() {
		super({
			objectMode: true,
			readableObjectMode: true,
			writableObjectMode: true
		});
	}

	_transform(
		stellarMessage: StellarMessage,
		encoding: string,
		next: TransformCallback
	): void {
		if (stellarMessage.type !== 'scpMessage') return next();

		const signatureKey = Buffer.from(
			stellarMessage.envelope.signature.toBytes()
		).toString();
		if (this.cache.has(signatureKey)) {
			console.log('cache hit');
			return next();
		}

		this.cache.set(signatureKey, 1);

		//todo: if we use worker pool and 'async' next call, will the internal buffer fill up too fast and block reading?
		if (
			verifySCPEnvelopeSignature(
				stellarMessage.envelope,
				Buffer.from(hash(Buffer.from(Networks.PUBLIC)))
			)
		)
			return next(null, stellarMessage.envelope.statement.toXdr('base64'));

		return next();
	}
}

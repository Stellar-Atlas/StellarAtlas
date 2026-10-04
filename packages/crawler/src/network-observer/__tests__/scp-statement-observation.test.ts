import { Keypair, Networks, hash, xdr } from '@stellar/stellar-sdk';
import { createSCPEnvelopeSignature } from 'node-connector';
import { createDummyExternalizeStatement } from '@fixtures/createDummyExternalizeMessage.js';
import { createScpStatementObservation } from '../scp-statement-observation.js';

// Captured from SDK16.2 with a deterministic non-production fixture key.
const statementXdr =
	'AAAAAOpKbGPinFIKvvVQexMuxfmVR3auvr57kkIe6mkURtIsACAAAAAAAAEAAAACAAAAAQAAAJgF16P1eQxE1rmZh55yhHxbX4TXQ3xyN7aKth+bM2H94gAAAABl3Z8IAAAAAAAAAAEAAAAAjB1LSjYBF9UA38+M3rFmsZoS4PS3vNOhoMXpnkH2l5kAAABAhHL9tZyUrBaTEXipM6DSkGdxd+kmFzMtA/kPrQmWqGBHlXNyfUo4dNJq/EFLz6ZkJpc0h7iIkUV8Y+fGZGAFAgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

it('preserves SDK16 statement bytes, signature, hash and uint64 slot identity', () => {
	const key = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
	const statement = createDummyExternalizeStatement(key, '9007199254740993');
	const signed = createSCPEnvelopeSignature(
		statement,
		Buffer.from(key.rawPublicKey()),
		Buffer.from(key.rawSecretKey()),
		Buffer.from(hash(Buffer.from(Networks.PUBLIC)))
	);
	if (signed.isErr()) throw signed.error;
	const result = createScpStatementObservation(
		new xdr.ScpEnvelope({ statement, signature: signed.value }),
		'fixture-peer',
		'127.0.0.1:11625',
		new Date('2026-10-04T00:00:00Z')
	);
	if (result.isErr()) throw result.error;
	expect(result.value.nodeId).toBe(
		'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'
	);
	expect(result.value.statementXdr).toBe(statementXdr);
	expect(result.value.slotIndex).toBe('9007199254740993');
	expect(result.value.statementHash).toBe(
		'0GdULQkk992EaKqQSALE9q+WdwZleeNug1CVVmF8KHw='
	);
	expect(result.value.signature).toBe(
		'B+mDLqoy8rGO+bQHWxw7TTiXgId270ieMRiBxesM9UBoKT9NIfMj6/tt0OcbR6sikT73Q3A5vBtJdL4pxMK3Cw=='
	);
	expect(result.value.values).toHaveLength(1);
	expect(result.value.values[0]?.closeTime).toBe('1709022984');
});

import { Keypair, xdr } from '@stellar/stellar-sdk';
import {
	SCPStatement,
	ScpNomination,
	ScpStatementPrepare
} from '../src/scp-statement-dto';

test('maps nomination accepted values separately from votes', () => {
	const keyPair = Keypair.random();
	const vote = Buffer.alloc(32, 1);
	const accepted = Buffer.alloc(32, 2);
	const nomination = new xdr.ScpNomination({
		quorumSetHash: Buffer.alloc(32, 3),
		votes: [vote],
		accepted: [accepted]
	});
	const statement = new xdr.ScpStatement({
		nodeId: xdr.PublicKey.publicKeyTypeEd25519(keyPair.rawPublicKey()),
		slotIndex: xdr.Uint64.fromString('42'),
		pledges: xdr.ScpStatementPledges.scpStNominate(nomination)
	});

	const result = SCPStatement.fromXdr(statement);

	expect(result.isOk()).toBeTruthy();
	if (result.isErr()) throw result.error;
	const pledges = result.value.pledges as ScpNomination;
	expect(result.value.type).toBe('nominate');
	expect(result.value.slotIndex).toBe('42');
	expect(pledges.votes).toEqual([vote.toString('base64')]);
	expect(pledges.accepted).toEqual([accepted.toString('base64')]);
});

test('maps prepare nC and nH to their matching pledge fields', () => {
	const keyPair = Keypair.random();
	const prepare = new xdr.ScpStatementPrepare({
		quorumSetHash: Buffer.alloc(32, 3),
		ballot: new xdr.ScpBallot({
			counter: 7,
			value: Buffer.alloc(32, 4)
		}),
		prepared: null,
		preparedPrime: null,
		nC: 11,
		nH: 22
	});
	const statement = new xdr.ScpStatement({
		nodeId: xdr.PublicKey.publicKeyTypeEd25519(keyPair.rawPublicKey()),
		slotIndex: xdr.Uint64.fromString('43'),
		pledges: xdr.ScpStatementPledges.scpStPrepare(prepare)
	});

	const result = SCPStatement.fromXdr(statement);

	expect(result.isOk()).toBeTruthy();
	if (result.isErr()) throw result.error;
	const pledges = result.value.pledges as ScpStatementPrepare;
	expect(result.value.type).toBe('prepare');
	expect(pledges.nC).toBe(11);
	expect(pledges.nH).toBe(22);
});

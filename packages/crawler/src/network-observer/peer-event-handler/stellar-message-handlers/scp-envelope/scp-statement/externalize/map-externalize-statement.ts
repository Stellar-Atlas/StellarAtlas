import { xdr } from '@stellar/stellar-sdk';
import { err, ok, Result } from 'neverthrow';
import { getPublicKeyStringFromBuffer } from 'node-connector';
import { extractCloseTimeFromValue } from './extract-close-time-from-value.js';

export interface ExternalizeData {
	publicKey: string;
	slotIndex: bigint;
	value: string;
	closeTime: Date;
}

export function mapExternalizeStatement(
	externalizeStatement: xdr.ScpStatement
): Result<ExternalizeData, Error> {
	const publicKeyResult = getPublicKeyStringFromBuffer(
		Buffer.from(externalizeStatement.nodeId.value.toBytes())
	);
	if (publicKeyResult.isErr()) {
		return err(publicKeyResult.error);
	}

	const publicKey = publicKeyResult.value;
	const slotIndex = externalizeStatement.slotIndex;

	const pledges = externalizeStatement.pledges;
	if (pledges.type !== 'scpStExternalize')
		return err(new Error('Expected externalize statement'));
	const value = pledges.value.commit.value.toBytes();

	const closeTime = extractCloseTimeFromValue(value);

	return ok({
		publicKey,
		slotIndex,
		value: Buffer.from(value).toString('base64'),
		closeTime
	});
}

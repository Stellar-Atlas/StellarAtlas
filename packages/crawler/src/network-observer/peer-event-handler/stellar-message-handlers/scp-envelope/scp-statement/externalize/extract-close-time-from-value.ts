import { xdr } from '@stellar/stellar-sdk';

export function extractCloseTimeFromValue(value: Uint8Array) {
	try {
		return new Date(1000 * Number(xdr.StellarValue.fromXDR(value).closeTime));
	} catch (error) {
		return new Date();
	}
}

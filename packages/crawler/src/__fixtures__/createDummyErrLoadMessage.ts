import { xdr } from '@stellar/stellar-sdk';

export function createDummyErrLoadMessage() {
	return xdr.StellarMessage.errorMsg(
		new xdr.Error({
			code: xdr.ErrorCode.errLoad(),
			msg: 'Error loading'
		})
	);
}

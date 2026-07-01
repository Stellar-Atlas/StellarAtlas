import { xdr } from '@stellar/stellar-sdk';
import MessageType = xdr.MessageType;

export function isFloodMessage(messageType: MessageType): boolean {
	return [
		MessageType.scpMessage(),
		MessageType.floodAdvert(),
		MessageType.transaction(),
		MessageType.floodDemand()
	].includes(messageType);
}

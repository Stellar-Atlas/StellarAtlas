import { Payload, PublicKey } from '../Overlay.js';
import { OverlayEvent } from './OverlayEvent.js';

export class BroadcastFailed extends OverlayEvent {
	subType = 'BroadcastFailed';

	constructor(
		public readonly broadcaster: PublicKey,
		public readonly payload: Payload
	) {
		super(broadcaster);
	}

	toString(): string {
		return `${this.broadcaster} failed to broadcast message: "${this.payload}"`;
	}
}

import { Message } from '../Message.js';
import { OverlayEvent } from '../../overlay/event/OverlayEvent.js';

export class MessageReceived extends OverlayEvent {
	subType = 'MessageReceived';

	constructor(public readonly message: Message) {
		super(message.receiver);
	}

	toString(): string {
		return `${this.message.toString()}`;
	}
}

import { QuorumSet } from 'shared';
import pino from 'pino';
import { Slot, SlotIndex } from './slot.js';

export class Slots {
	protected slots: Map<SlotIndex, Slot> = new Map<SlotIndex, Slot>();
	protected trustedQuorumSet: QuorumSet;

	constructor(
		trustedQuorumSet: QuorumSet,
		protected logger: pino.Logger,
		private readonly maxRetainedSlots = 256
	) {
		this.trustedQuorumSet = trustedQuorumSet;
		if (maxRetainedSlots < 1) {
			throw new Error('At least one SCP slot must be retained');
		}
	}

	public getSlot(slotIndex: SlotIndex): Slot {
		let slot = this.slots.get(slotIndex);
		if (!slot) {
			slot = new Slot(slotIndex, this.trustedQuorumSet, this.logger);
			this.slots.set(slotIndex, slot);
			this.pruneOldestSlots();
		}

		return slot;
	}

	getConfirmedClosedSlotIndexes(): bigint[] {
		return Array.from(this.slots.values())
			.filter((slot) => slot.confirmedClosed())
			.map((slot) => slot.index);
	}

	private pruneOldestSlots(): void {
		while (this.slots.size > this.maxRetainedSlots) {
			let oldest: SlotIndex | undefined;
			for (const slotIndex of this.slots.keys()) {
				if (oldest === undefined || slotIndex < oldest) oldest = slotIndex;
			}
			if (oldest === undefined) return;
			this.slots.delete(oldest);
		}
	}
}

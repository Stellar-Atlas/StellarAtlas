import { QuorumSet } from 'shared';
import { mock } from 'jest-mock-extended';
import pino from 'pino';
import { Slots } from '../slots.js';

describe('slots', () => {
	it('should create new slot', () => {
		const trustedQuorumSet = new QuorumSet(2, ['A', 'B', 'C'], []);
		const logger = mock<pino.Logger>();
		const slots = new Slots(trustedQuorumSet, logger);
		const slot = slots.getSlot(BigInt(1));
		expect(slot).toBeDefined();
		expect(slot.index).toEqual(BigInt(1));
	});

	it('should return same slot if already created', () => {
		const trustedQuorumSet = new QuorumSet(2, ['A', 'B', 'C'], []);
		const logger = mock<pino.Logger>();
		const slots = new Slots(trustedQuorumSet, logger);
		const slot = slots.getSlot(BigInt(1));
		const slot2 = slots.getSlot(BigInt(1));
		expect(slot).toBe(slot2);
	});

	it('should return empty set if no confirmed closed ledger', () => {
		const trustedQuorumSet = new QuorumSet(2, ['A', 'B', 'C'], []);
		const logger = mock<pino.Logger>();
		const slots = new Slots(trustedQuorumSet, logger);
		slots.getSlot(BigInt(1));
		expect(slots.getConfirmedClosedSlotIndexes()).toEqual([]);
	});

	it('should return confirmed closed slot indexes', () => {
		const trustedQuorumSet = new QuorumSet(1, ['A'], []);
		const logger = mock<pino.Logger>();
		const slots = new Slots(trustedQuorumSet, logger);
		const slot = slots.getSlot(BigInt(1));
		slot.addExternalizeValue('A', 'test value', new Date());
		slots.getSlot(BigInt(2));

		expect(slots.getConfirmedClosedSlotIndexes()).toEqual([BigInt(1)]);
	});

	it('bounds retained slots for long-running observations', () => {
		const trustedQuorumSet = new QuorumSet(1, ['A'], []);
		const logger = mock<pino.Logger>();
		const slots = new Slots(trustedQuorumSet, logger, 2);
		for (const slotIndex of [1n, 2n, 3n]) {
			slots
				.getSlot(slotIndex)
				.addExternalizeValue('A', 'test value', new Date());
		}

		expect(slots.getConfirmedClosedSlotIndexes()).toEqual([2n, 3n]);
	});

	it('rejects an empty slot retention window', () => {
		expect(
			() => new Slots(new QuorumSet(1, ['A'], []), mock<pino.Logger>(), 0)
		).toThrow('At least one SCP slot must be retained');
	});
});

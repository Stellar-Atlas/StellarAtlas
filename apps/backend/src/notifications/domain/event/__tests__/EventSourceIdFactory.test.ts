import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { EventSourceIdFactory } from '../EventSourceIdFactory.js';
import type { EventSourceService } from '../EventSourceService.js';
import { NetworkId, OrganizationId, PublicKey } from '../EventSourceId.js';

const time = new Date('2026-11-02T00:00:00.000Z');
const sources = [
	[
		'node',
		'GCFXHS4GXL6BVUCXBWXGTITROWLVYXQKQLF4YH5O5JT3YZXCYPAFBJZB',
		PublicKey
	],
	['organization', 'fixture-organization', OrganizationId],
	['network', 'public', NetworkId]
] as const;

describe.each(sources)('%s source validation', (type, id, SourceId) => {
	it('accepts a known source and retains its identifier', async () => {
		const service = mock<EventSourceService>();
		service.isEventSourceIdKnown.mockResolvedValue(ok(true));
		const result = await new EventSourceIdFactory(service).create(
			type,
			id,
			time
		);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toBeInstanceOf(SourceId);
		expect(result.value.value).toBe(id);
		expect(service.isEventSourceIdKnown).toHaveBeenCalledTimes(1);
		expect(service.isEventSourceIdKnown).toHaveBeenCalledWith(
			result.value,
			time
		);
	});

	it('rejects an unknown source returned as ok(false)', async () => {
		const service = mock<EventSourceService>();
		service.isEventSourceIdKnown.mockResolvedValue(ok(false));
		const result = await new EventSourceIdFactory(service).create(
			type,
			id,
			time
		);

		expect(result.isErr()).toBe(true);
		if (result.isOk()) throw new Error('Unknown source was accepted');
		expect(result.error.message).toMatch(/unknown/i);
		expect(service.isEventSourceIdKnown).toHaveBeenCalledTimes(1);
		expect(service.isEventSourceIdKnown).toHaveBeenCalledWith(
			expect.objectContaining({ value: id }),
			time
		);
	});

	it('propagates the original lookup error', async () => {
		const service = mock<EventSourceService>();
		const failure = new Error('Fixture source lookup failed');
		service.isEventSourceIdKnown.mockResolvedValue(err(failure));
		const result = await new EventSourceIdFactory(service).create(
			type,
			id,
			time
		);

		expect(result.isErr()).toBe(true);
		if (result.isOk()) throw new Error('Failed lookup was accepted');
		expect(result.error).toBe(failure);
		expect(service.isEventSourceIdKnown).toHaveBeenCalledTimes(1);
		expect(service.isEventSourceIdKnown).toHaveBeenCalledWith(
			expect.objectContaining({ value: id }),
			time
		);
	});
});

it('rejects a malformed node key before looking up the source', async () => {
	const service = mock<EventSourceService>();
	const result = await new EventSourceIdFactory(service).create(
		'node',
		'invalid-public-key',
		time
	);

	expect(result.isErr()).toBe(true);
	expect(service.isEventSourceIdKnown).not.toHaveBeenCalled();
});

import { mock } from 'jest-mock-extended';
import { EventDetector } from '../EventDetector.js';
import type { EventRepository } from '../EventRepository.js';
import { NetworkEventDetector } from '../NetworkEventDetector.js';
import { NodeEventDetector } from '../NodeEventDetector.js';
import { Event, EventData, MultipleUpdatesEventData } from '../Event.js';
import { NetworkId, OrganizationId, PublicKey } from '../EventSourceId.js';
import { ok } from 'neverthrow';
import { createDummyNetworkV1 } from '@network-scan/services/__fixtures__/createDummyNetworkV1.js';

it('should return all events', async function () {
	const eventRepository = mock<EventRepository>();
	const networkEventDetector = mock<NetworkEventDetector>();
	const nodeEventDetector = mock<NodeEventDetector>();

	const eventDetector = new EventDetector(
		eventRepository,
		networkEventDetector,
		nodeEventDetector
	);

	eventRepository.findOrganizationMeasurementEventsForXNetworkScans.mockResolvedValue(
		['a' as unknown as Event<MultipleUpdatesEventData, OrganizationId>]
	);
	networkEventDetector.detect.mockReturnValue(
		ok(['b' as unknown as Event<EventData, NetworkId>])
	);
	nodeEventDetector.detect.mockResolvedValue([
		'c' as unknown as Event<MultipleUpdatesEventData, PublicKey>
	]);

	const eventsOrError = await eventDetector.detect(
		createDummyNetworkV1(),
		createDummyNetworkV1()
	);
	if (eventsOrError.isErr()) throw eventsOrError.error;
	expect(eventsOrError.value.sort()).toEqual(['a', 'b', 'c']);
});

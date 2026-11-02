import fs from 'node:fs';
import path from 'node:path';
import { err, ok } from 'neverthrow';
import type { IUserService } from '@core/domain/IUserService.js';
import { Message } from '@core/domain/Message.js';
import { UserNotFoundError } from '@core/services/UserService.js';
import { Subscriber } from '../../../domain/subscription/Subscriber.js';
import type { SubscriberRepository } from '../../../domain/subscription/SubscriberRepository.js';
import { Subscription } from '../../../domain/subscription/Subscription.js';
import { SubscriberReference } from '../../../domain/subscription/SubscriberReference.js';
import { UserId } from '../../../domain/subscription/UserId.js';
import { PendingSubscriptionId } from '../../../domain/subscription/PendingSubscription.js';
import { PublicKey } from '../../../domain/event/EventSourceId.js';
import {
	EventType,
	HistoryArchiveErrorDetectedEvent
} from '../../../domain/event/Event.js';

const key = PublicKey.create(
	'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH'
);
if (key.isErr()) throw key.error;
export const fixtureNode = key.value;
export const fixtureEmail = 'archive-operator@fixture.invalid';
const parsedUser = UserId.create('16420410-4c34-4abe-8a98-3ef47f29b4f5');
if (parsedUser.isErr()) throw parsedUser.error;
export const fixtureUser = parsedUser.value;
const pending = PendingSubscriptionId.create(
	'946b629a-5048-4092-a7d5-6e5c63e8d32b'
);
if (pending.isErr()) throw pending.error;
const fixturePending = pending.value;

interface StoredState {
	latestSendTime: string;
	eventType: EventType.HistoryArchiveErrorDetected;
	ignoreCoolOffPeriod: boolean;
}
interface Snapshot {
	userId: string;
	reference: string;
	registeredAt: string;
	active: boolean;
	pendingId: string | null;
	states: StoredState[];
}

/** Test-only adapter for the actual existing columns, not a database replacement. */
export class CurrentNotificationStore implements SubscriberRepository {
	private readonly file: string;
	constructor(directory: string) {
		this.file = path.join(directory, 'current-state.json');
	}

	async find(): Promise<Subscriber[]> {
		if (!fs.existsSync(this.file)) return [];
		const raw: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
		if (!isSnapshot(raw))
			throw new Error('Invalid controlled fixture snapshot');
		const user = UserId.create(raw.userId);
		const reference = SubscriberReference.createFromValue(raw.reference);
		if (user.isErr()) throw user.error;
		if (reference.isErr()) throw reference.error;
		const subscriber = Subscriber.create({
			userId: user.value,
			SubscriberReference: reference.value,
			registrationDate: new Date(raw.registeredAt)
		});
		if (raw.active) {
			subscriber.addPendingSubscription(
				fixturePending,
				[fixtureNode],
				new Date(raw.registeredAt)
			);
			const confirmed = subscriber.confirmPendingSubscription(fixturePending);
			if (confirmed.isErr()) throw confirmed.error;
			for (const state of raw.states) {
				// Reconstruct only the stored columns via public domain APIs; no mail is sent.
				subscriber.publishNotificationAbout([
					new HistoryArchiveErrorDetectedEvent(
						new Date(state.latestSendTime),
						fixtureNode,
						{}
					)
				]);
				if (state.ignoreCoolOffPeriod)
					subscriber.unMuteNotificationFor(fixtureNode, state.eventType);
			}
		}
		if (raw.pendingId !== null) {
			const id = PendingSubscriptionId.create(raw.pendingId);
			if (id.isErr()) throw id.error;
			subscriber.addPendingSubscription(
				id.value,
				[fixtureNode],
				new Date(raw.registeredAt)
			);
		}
		return [subscriber];
	}

	async findOneByUserId(id: UserId): Promise<Subscriber | null> {
		return (await this.find()).find((s) => s.userId.value === id.value) ?? null;
	}
	async findOneBySubscriberReference(
		ref: SubscriberReference
	): Promise<Subscriber | null> {
		return (
			(await this.find()).find(
				(s) => s.subscriberReference.value === ref.value
			) ?? null
		);
	}
	async findOneByPendingSubscriptionId(
		id: PendingSubscriptionId
	): Promise<Subscriber | null> {
		return (
			(await this.find()).find((s) =>
				s.pendingSubscription?.pendingSubscriptionId.equals(id)
			) ?? null
		);
	}
	nextPendingSubscriptionId(): PendingSubscriptionId {
		return fixturePending;
	}

	async save(subscribers: Subscriber[]): Promise<Subscriber[]> {
		for (const subscriber of subscribers) {
			const snapshot: Snapshot = {
				userId: subscriber.userId.value,
				reference: subscriber.subscriberReference.value,
				registeredAt: subscriber.registrationDate.toISOString(),
				active: subscriber.isSubscribedTo(fixtureNode),
				pendingId:
					subscriber.pendingSubscription?.pendingSubscriptionId.value ?? null,
				states: storedStates(subscriber)
			};
			fs.writeFileSync(this.file, JSON.stringify(snapshot, null, 2));
		}
		return subscribers;
	}
	async remove(subscriber: Subscriber): Promise<Subscriber> {
		fs.rmSync(this.file, { force: true });
		return subscriber;
	}
	readStoredStates(): unknown {
		const raw: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
		if (!isSnapshot(raw))
			throw new Error('Invalid controlled fixture snapshot');
		return raw.states;
	}
}

function storedStates(subscriber: Subscriber): StoredState[] {
	// ORM owns this protected relation in production. This fixture reflects it only
	// after validating the actual class, and never alters it or bypasses domain validators.
	const related: unknown = Reflect.get(subscriber, 'subscriptions');
	if (!Array.isArray(related)) throw new Error('Missing subscription relation');
	const states: StoredState[] = [];
	for (const subscription of related) {
		if (!(subscription instanceof Subscription))
			throw new Error('Invalid subscription relation');
		for (const state of subscription.eventNotificationStates) {
			if (state.eventType !== EventType.HistoryArchiveErrorDetected)
				throw new Error('Unexpected fixture event');
			states.push({
				latestSendTime: state.latestSendTime.toISOString(),
				eventType: state.eventType,
				ignoreCoolOffPeriod: state.ignoreCoolOffPeriod
			});
		}
	}
	return states;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isSnapshot(value: unknown): value is Snapshot {
	return (
		record(value) &&
		typeof value.userId === 'string' &&
		typeof value.reference === 'string' &&
		typeof value.registeredAt === 'string' &&
		Number.isFinite(Date.parse(value.registeredAt)) &&
		typeof value.active === 'boolean' &&
		(value.pendingId === null || typeof value.pendingId === 'string') &&
		Array.isArray(value.states) &&
		value.states.length <= 1 &&
		value.states.every(
			(state) =>
				record(state) &&
				typeof state.latestSendTime === 'string' &&
				Number.isFinite(Date.parse(state.latestSendTime)) &&
				state.eventType === EventType.HistoryArchiveErrorDetected &&
				typeof state.ignoreCoolOffPeriod === 'boolean'
		)
	);
}

/** Local fake transport seam: no HTTP/SMTP/Mailgun or actual recipient lookup. */
export class CapturingMailTransport implements IUserService {
	readonly messages: Message[] = [];
	failNext = false;
	private exists = false;
	async findOrCreateUser(address: string) {
		if (address !== fixtureEmail)
			return err(new Error('Only fixture.invalid is permitted'));
		this.exists = true;
		return ok(fixtureUser);
	}
	async findUser(address: string) {
		return ok(address === fixtureEmail && this.exists ? fixtureUser : null);
	}
	async deleteUser(id: UserId) {
		if (id.value !== fixtureUser.value || !this.exists)
			return err(new UserNotFoundError(id));
		this.exists = false;
		return ok(undefined);
	}
	async send(id: UserId, message: Message) {
		if (id.value !== fixtureUser.value || !this.exists)
			return err(new UserNotFoundError(id));
		if (this.failNext) {
			this.failNext = false;
			return err(new Error('Synthetic sink rejection'));
		}
		this.messages.push(message);
		return ok(undefined);
	}
	get alerts(): readonly Message[] {
		return this.messages.filter((m) => m.title.startsWith('Event(s)'));
	}
}

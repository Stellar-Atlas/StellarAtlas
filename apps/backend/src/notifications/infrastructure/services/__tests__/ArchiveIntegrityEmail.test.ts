import { ok } from 'neverthrow';
import { mock } from 'jest-mock-extended';
import { EJSMessageCreator } from '../EJSMessageCreator.js';
import type { EventSourceService } from '../../../domain/event/EventSourceService.js';
import { EventSource } from '../../../domain/event/EventSource.js';
import {
	NetworkId,
	OrganizationId,
	PublicKey
} from '../../../domain/event/EventSourceId.js';
import {
	HistoryArchiveIntegrityFailureDetectedEvent,
	HistoryArchiveErrorDetectedEvent,
	NetworkLossOfLivenessEvent,
	OrganizationXUpdatesUnavailableEvent
} from '../../../domain/event/Event.js';
import { createDummySubscriber } from '../../../domain/subscription/__fixtures__/Subscriber.fixtures.js';
import {
	getArchiveScanDetailPath,
	decodeArchiveScanRouteParam
} from '../../../../../../frontend-v4/src/domain/archive-scan-routes.js';

const time = new Date('2026-11-02T00:00:00.000Z');
const key = PublicKey.create(
	'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH'
);
if (key.isErr()) throw key.error;
const node = key.value;
const root = 'https://history.invalid/archive';

function integrityEvent(overrides: Record<string, unknown> = {}) {
	const data = {
		actionId: 'replace-bucket-file:fixture-evidence',
		archiveUrl: root,
		bucketHash: 'a'.repeat(64),
		checkpointLedger: 63,
		evidenceId: 'fixture-evidence',
		evidenceObservedAt: time.toISOString(),
		failureCode: 'bucket_hash_mismatch',
		objectKey: 'bucket/a.xdr.gz',
		objectType: 'bucket',
		repairPlanPath: '/v1/unused'
	};
	// Deliberately malformed runtime payloads exercise validation without casts.
	Object.assign(data, overrides);
	return new HistoryArchiveIntegrityFailureDetectedEvent(time, node, data);
}

async function render(base: string, event = integrityEvent()) {
	const service = mock<EventSourceService>();
	service.findEventSource.mockImplementation(async (id) =>
		ok(new EventSource(id, 'Fixture source'))
	);
	const subscriber = createDummySubscriber();
	const message = await new EJSMessageCreator(
		base,
		service
	).createNotificationMessage({
		subscriber,
		time,
		events: [
			event,
			new NetworkLossOfLivenessEvent(time, new NetworkId('public'), {
				from: 5,
				to: 3
			}),
			new OrganizationXUpdatesUnavailableEvent(
				time,
				new OrganizationId('fixture-org'),
				{ numberOfUpdates: 3 }
			)
		]
	});
	return { html: message.body, subscriber };
}

it.each(['https://frontend.invalid', 'http://frontend.invalid/'])(
	'renders the frontend details link for %s and preserves ordinary links',
	async (base) => {
		const { html, subscriber } = await render(base);
		const prefix = base.replace(/\/+$/, '');
		expect(html).toContain(
			`href="${prefix}${getArchiveScanDetailPath(root)}">Archive verification details</a>`
		);
		expect(html).toContain(`Archive: ${root}`);
		expect(html).toContain('Object: bucket/a.xdr.gz');
		expect(html).toContain('Failure: bucket_hash_mismatch');
		expect(html).toContain(`Observed: ${time.toISOString()}`);
		expect(html).toContain(`href="${base}/nodes/${node.value}"`);
		expect(html).toContain(
			`href="${base}/nodes/${node.value}?at=${time.toISOString()}"`
		);
		expect(html).toContain(`href="${base}"`);
		expect(html).toContain(`href="${base}/organizations/fixture-org"`);
		expect(html).toContain(
			`${base}/notify/${subscriber.subscriberReference.value}/unmute?`
		);
		expect(html).toContain(
			`${base}/notify/${subscriber.subscriberReference.value}/unsubscribe`
		);
		expect(html).not.toContain('/v1/unused');
		expect(html).not.toContain('repair-plan');
	}
);

it.each([
	['HTTPS://HISTORY.INVALID/archive///', 'https://history.invalid/archive'],
	['https://history.invalid/hist/雪', 'https://history.invalid/hist/%E9%9B%AA'],
	[
		'https://history.invalid/path%3Fname',
		'https://history.invalid/path%3Fname'
	],
	['http://history.bd-trust.org/galou/', 'http://history.bd-trust.org/GALOU']
])(
	'uses the existing route encoding for canonical root %s',
	async (input, canonical) => {
		const { html } = await render(
			'https://frontend.invalid',
			integrityEvent({ archiveUrl: input })
		);
		const match = html.match(
			/href="([^"]+)">Archive verification details<\/a>/
		);
		expect(match).not.toBeNull();
		if (match?.[1] === undefined)
			throw new Error('Missing fixture details link');
		const url = new URL(match[1]);
		expect(url.pathname).toBe(getArchiveScanDetailPath(canonical));
		expect(
			decodeArchiveScanRouteParam(url.pathname.slice('/archive-scans/'.length))
		).toBe(canonical);
		expect(url.search).toBe('');
		expect(url.hash).toBe('');
	}
);

it('escapes rich evidence and ignores raw diagnostics and supplied links', async () => {
	const { html } = await render(
		'https://frontend.invalid',
		integrityEvent({
			archiveUrl: 'https://history.invalid/a&b',
			objectKey: '<img src=x onerror="alert(1)">',
			failureCode: 'mismatch<&"\'',
			errorMessage: 'RAW_DIAGNOSTIC_MUST_NOT_RENDER',
			repairPlanPath: 'javascript:UNTRUSTED_LINK_MUST_NOT_RENDER'
		})
	);
	expect(html).toContain('https://history.invalid/a&amp;b');
	expect(html).toContain('&lt;img src=x onerror=&#34;alert(1)&#34;&gt;');
	expect(html).toContain('mismatch&lt;&amp;&#34;&#39;');
	expect(html).not.toContain('<img src=x');
	expect(html).not.toContain('RAW_DIAGNOSTIC_MUST_NOT_RENDER');
	expect(html).not.toContain('UNTRUSTED_LINK_MUST_NOT_RENDER');
});

it.each([
	'https://history.invalid/archive?access_token=synthetic_token_marker',
	'https://history.invalid/archive?a=1&b=2',
	'https://history.invalid/archive?'
])(
	'omits query-bearing rich evidence without changing its identity: %s',
	async (archiveUrl) => {
		const { html, subscriber } = await render(
			'https://frontend.invalid',
			integrityEvent({ archiveUrl })
		);
		expect(html).not.toContain('Archive verification details');
		expect(html).not.toContain('Archive:');
		expect(html).not.toContain('synthetic_token_marker');
		expect(html).not.toContain(
			Buffer.from(archiveUrl, 'utf8').toString('base64url')
		);
		expect(html).not.toContain(getArchiveScanDetailPath(root));
		expect(html).toContain('Error in history archive detected');
		expect(html).toContain(
			`href="https://frontend.invalid/nodes/${node.value}"`
		);
		expect(html).toContain(
			`https://frontend.invalid/notify/${subscriber.subscriberReference.value}/unsubscribe`
		);
	}
);

it('preserves a trusted frontend path prefix without doubling its slash', async () => {
	const { html } = await render(
		'https://frontend.invalid/atlas/',
		integrityEvent()
	);
	expect(html).toContain(
		`href="https://frontend.invalid/atlas${getArchiveScanDetailPath(root)}">Archive verification details</a>`
	);
});

it.each([
	{ archiveUrl: 'javascript:alert(1)' },
	{ archiveUrl: 'https://user:password@history.invalid/archive' },
	{ archiveUrl: 'https://history.invalid/archive#fragment' },
	{ archiveUrl: 'https://history.invalid/\narchive' },
	{ archiveUrl: 'not a root' },
	{ archiveUrl: null },
	{ archiveUrl: 'x'.repeat(2049) },
	{ objectKey: null },
	{ objectKey: '' },
	{ objectKey: 'x'.repeat(513) },
	{ objectKey: 'object\nraw diagnostic' },
	{ failureCode: { message: 'invalid code' } },
	{ failureCode: 'x'.repeat(129) },
	{ evidenceObservedAt: 'not a date' },
	{ evidenceObservedAt: '2026' },
	{ evidenceObservedAt: undefined }
])(
	'omits malformed rich evidence without losing ordinary rendering: %j',
	async (overrides) => {
		const { html } = await render(
			'https://frontend.invalid',
			integrityEvent(overrides)
		);
		expect(html).not.toContain('Archive verification details');
		expect(html).not.toContain('Archive:');
		expect(html).toContain(
			`href="https://frontend.invalid/nodes/${node.value}"`
		);
		expect(html).toContain(
			'https://frontend.invalid/organizations/fixture-org'
		);
		expect(html).toContain('/unsubscribe');
	}
);

it.each([
	'javascript:alert(1)',
	'data:text/html,unsafe',
	'//frontend.invalid',
	'https://user:password@frontend.invalid',
	'https://frontend.invalid?secret=value',
	'https://frontend.invalid#fragment',
	'https://frontend.invalid\n'
])('omits the rich link for unsafe frontend base %s', async (base) => {
	const { html } = await render(base);
	expect(html).not.toContain('Archive verification details');
	expect(html).toContain('Error in history archive detected');
});

it('omits missing evidence payloads without throwing', async () => {
	const event = integrityEvent();
	Object.defineProperty(event, 'data', { value: null });
	expect((await render('https://frontend.invalid', event)).html).not.toContain(
		'Archive verification details'
	);
});

it('keeps legacy archive alerts renderable without treating them as rich integrity evidence', async () => {
	const service = mock<EventSourceService>();
	service.findEventSource.mockResolvedValue(
		ok(new EventSource(node, 'Fixture node'))
	);
	const message = await new EJSMessageCreator(
		'https://frontend.invalid',
		service
	).createNotificationMessage({
		subscriber: createDummySubscriber(),
		time,
		events: [
			new HistoryArchiveErrorDetectedEvent(time, node, { archiveUrl: root })
		]
	});
	expect(message.body).toContain('Error in history archive detected');
	expect(message.body).not.toContain('Archive verification details');
});

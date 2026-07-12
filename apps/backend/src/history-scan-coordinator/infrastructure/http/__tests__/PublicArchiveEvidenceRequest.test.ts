import express from 'express';
import request from 'supertest';
import {
	PublicArchiveEvidenceAdmission,
	resolvePublicArchiveEvidenceIdentity
} from '../PublicArchiveEvidenceRequest.js';

describe('PublicArchiveEvidenceAdmission', () => {
	it('ignores spoofed forwarding headers from a direct peer', () => {
		expect(
			resolvePublicArchiveEvidenceIdentity({
				cfConnectingIp: '198.51.100.7',
				forwardedFor: '198.51.100.8',
				remoteAddress: '203.0.113.9'
			})
		).toBe('socket:203.0.113.9');
	});

	it('accepts a validated Cloudflare client only through loopback ingress', () => {
		expect(
			resolvePublicArchiveEvidenceIdentity({
				cfConnectingIp: '2001:0db8:0:0:0:0:0:7',
				forwardedFor: '198.51.100.8',
				remoteAddress: '::ffff:127.0.0.1'
			})
		).toBe('ingress:2001:db8::7');
		expect(
			resolvePublicArchiveEvidenceIdentity({
				forwardedFor: '198.51.100.8',
				remoteAddress: '127.0.0.1'
			})
		).toBeNull();
	});

	it('does not collapse unattributed loopback ingress into one rate window', async () => {
		const admission = new PublicArchiveEvidenceAdmission(4, 1);
		const app = createApp(admission);

		for (let index = 0; index < 3; index++) {
			await request(app)
				.get('/')
				.set('X-Forwarded-For', `198.51.100.${index + 1}`)
				.expect(204);
		}
		expect(admission.getTrackedIdentityCount()).toBe(0);
	});

	it('rate limits attributed ingress clients and bounds identity storage', async () => {
		const admission = new PublicArchiveEvidenceAdmission(
			4,
			1,
			60_000,
			Date.now,
			3
		);
		const app = createApp(admission);

		await request(app)
			.get('/')
			.set('CF-Connecting-IP', '198.51.100.1')
			.expect(204);
		await request(app)
			.get('/')
			.set('CF-Connecting-IP', '198.51.100.1')
			.expect(429);
		for (let index = 2; index <= 8; index++) {
			await request(app)
				.get('/')
				.set('CF-Connecting-IP', `198.51.100.${index}`)
				.expect(204);
		}
		expect(admission.getTrackedIdentityCount()).toBeLessThanOrEqual(3);
	});
});

function createApp(admission: PublicArchiveEvidenceAdmission) {
	const app = express();
	app.set('trust proxy', true);
	app.get('/', admission.middleware(), (_req, res) => res.sendStatus(204));
	return app;
}

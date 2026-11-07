import express from 'express';
import request from 'supertest';
import {
	VerificationWorkflow,
	type ApplicationEvent,
	type Reviewer,
	type VerificationStore
} from '../VerificationWorkflow.js';
import {
	verificationRouter,
	type VerificationBoundary
} from '../VerificationRouter.js';
import { createAtlasVerification } from '../VerificationActivation.js';
import {
	parseSubmission,
	VerificationError,
	type Application,
	type ControlEvidence
} from '../VerificationApplication.js';
import type { DataSource } from 'typeorm';

const at = '2026-11-07T22:00:00.000Z';
const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const submission = {
	network: 'mainnet' as const,
	address,
	name: 'Example project',
	website: 'https://example.org/',
	supportingEvidence: 'Private supporting evidence for Atlas review'
};
function fixture() {
	const applications = new Map<string, Application>();
	const events: ApplicationEvent[] = [];
	const store: VerificationStore = {
		async create(application, event) {
			applications.set(application.id, application);
			events.push(event);
		},
		async find(id) {
			return applications.get(id) ?? null;
		},
		async update(revision, application, event) {
			if (applications.get(application.id)?.revision !== revision)
				throw new VerificationError(409, 'Application changed');
			applications.set(application.id, application);
			events.push(event);
		},
		async queue(after, limit) {
			return [...applications.values()]
				.filter((row) => row.state === 'pending' && row.id > after)
				.sort((a, b) => a.id.localeCompare(b.id))
				.slice(0, limit);
		},
		async approved(network, account) {
			return (
				[...applications.values()].find(
					(row) =>
						row.state === 'approved' &&
						row.network === network &&
						row.address === account
				) ?? null
			);
		}
	};
	let applicantId: string | null = 'applicant';
	let reviewer: Reviewer | null = null;
	let evidence: ControlEvidence | null = {
		subjectId: 'applicant',
		network: 'mainnet',
		address,
		method: 'stellar-account-authority',
		reference: 'trusted-authority-check',
		verifiedAt: at
	};
	const boundary: VerificationBoundary = {
		async applicant() {
			return applicantId ? { subjectId: applicantId } : null;
		},
		async reviewer() {
			return reviewer;
		},
		async control() {
			return evidence;
		}
	};
	const workflow = new VerificationWorkflow(store, () => new Date(at));
	const app = express()
		.use(express.json())
		.use('/verify', verificationRouter({ enabled: true, boundary, workflow }));
	return {
		applications,
		events,
		workflow,
		store,
		boundary,
		app,
		setApplicant(value: string | null) {
			applicantId = value;
		},
		setReviewer(value: Reviewer | null) {
			reviewer = value;
		},
		setControl(value: ControlEvidence | null) {
			evidence = value;
		},
		get control() {
			return evidence!;
		}
	};
}
const approval = {
	revision: 1,
	state: 'approved' as const,
	reason: 'Official identity evidence was reviewed',
	identityEvidenceReviewed: true
};
const reviewer: Reviewer = {
	subjectId: 'reviewer-1',
	role: 'identity-reviewer'
};

it('requires an explicit trusted boundary and defaults to no writes or reads', async () => {
	const database = {
		query: jest.fn(),
		transaction: jest.fn()
	} as unknown as DataSource;
	const app = express()
		.use(express.json())
		.use('/verify', createAtlasVerification({}, database));
	expect((await request(app).get('/verify/capabilities')).body.available).toBe(
		false
	);
	await request(app).post('/verify/applications').send(submission).expect(503);
	await request(app).get('/verify/review').expect(503);
	expect(database.query).not.toHaveBeenCalled();
	expect(database.transaction).not.toHaveBeenCalled();
	expect(() =>
		createAtlasVerification({ ATLAS_VERIFICATION_ENABLED: 'true' }, database)
	).toThrow('trusted');
	expect(() =>
		createAtlasVerification({ ATLAS_VERIFICATION_ENABLED: 'yes' }, database)
	).toThrow('true or false');
});
it('accepts an Atlas application without any upstream listing and keeps it private and pending', async () => {
	const f = fixture();
	const response = await request(f.app)
		.post('/verify/applications')
		.send(submission)
		.expect(201);
	expect(response.headers['cache-control']).toBe('private, no-store');
	expect(response.body.state).toBe('pending');
	expect(f.events[0]?.action).toBe('submitted');
	const publicRow = await request(f.app)
		.get('/verify/mainnet/' + address)
		.expect(200);
	expect(publicRow.body).toEqual({ verification: null });
	f.setApplicant('someone-else');
	const hidden = await request(f.app)
		.get('/verify/applications/' + response.body.id)
		.expect(404);
	expect(JSON.stringify(hidden.body)).not.toContain(
		submission.supportingEvidence
	);
	f.setApplicant(null);
	await request(f.app)
		.get('/verify/applications/' + response.body.id)
		.expect(401);
});
it.each(['network', 'address', 'subject', 'stale', 'future', 'absent'])(
	'rejects invalid control evidence (%s) before persistence',
	async (kind) => {
		const f = fixture();
		const control = { ...f.control };
		if (kind === 'network') control.network = 'testnet';
		if (kind === 'address') control.address = address.slice(0, -1) + 'A';
		if (kind === 'subject') control.subjectId = 'other';
		if (kind === 'stale') control.verifiedAt = '2026-11-07T21:54:59Z';
		if (kind === 'future') control.verifiedAt = '2026-11-07T22:00:01Z';
		f.setControl(kind === 'absent' ? null : control);
		await request(f.app)
			.post('/verify/applications')
			.send(submission)
			.expect(403);
		expect(f.events).toHaveLength(0);
	}
);
it('rejects client-supplied status, reviewer and control grants and invalid public fields', async () => {
	const f = fixture();
	for (const extra of [
		{ state: 'approved' },
		{ reviewerId: 'admin' },
		{ control: f.control },
		{ source: 'stellar-expert/public-directory' }
	])
		await request(f.app)
			.post('/verify/applications')
			.send({ ...submission, ...extra })
			.expect(400);
	for (const website of [
		'javascript:alert(1)',
		'http://example.org',
		'https://user:secret@example.org',
		'https://example.org/#secret'
	])
		expect(() => parseSubmission({ ...submission, website })).toThrow();
	expect(() =>
		parseSubmission({ ...submission, address: address.slice(0, -1) + 'A' })
	).toThrow();
	await request(f.app)
		.post('/verify/applications')
		.send({ ...submission, supportingEvidence: 'x'.repeat(17000) })
		.expect(400);
	expect(f.events).toHaveLength(0);
});
it('requires an independent reviewer, identity assessment, fresh authority and the current revision', async () => {
	const f = fixture();
	const application = await f.workflow.submit(
		'applicant',
		submission,
		f.control
	);
	await request(f.app)
		.post(`/verify/applications/${application.id}/decisions`)
		.send(approval)
		.expect(403);
	f.setReviewer({ subjectId: 'applicant', role: 'identity-reviewer' });
	await request(f.app)
		.post(`/verify/applications/${application.id}/decisions`)
		.send(approval)
		.expect(403);
	f.setReviewer(reviewer);
	await request(f.app)
		.post(`/verify/applications/${application.id}/decisions`)
		.send({ ...approval, identityEvidenceReviewed: false })
		.expect(400);
	f.setControl(null);
	await request(f.app)
		.post(`/verify/applications/${application.id}/decisions`)
		.send(approval)
		.expect(403);
	f.setControl({ ...application.control });
	await request(f.app)
		.post(`/verify/applications/${application.id}/decisions`)
		.send({ ...approval, revision: 99 })
		.expect(409);
	expect(f.events).toHaveLength(1);
});
it('publishes only approved public fields, supports revocation, and resubmits to pending', async () => {
	const f = fixture();
	const application = await f.workflow.submit(
		'applicant',
		submission,
		f.control
	);
	f.setReviewer(reviewer);
	await request(f.app)
		.post(`/verify/applications/${application.id}/decisions`)
		.send(approval)
		.expect(200);
	const response = await request(f.app)
		.get('/verify/mainnet/' + address)
		.expect(200);
	expect(response.body.verification).toEqual({
		source: 'stellaratlas/verification',
		publisher: 'StellarAtlas',
		status: 'verified',
		address,
		network: 'mainnet',
		name: submission.name,
		website: submission.website,
		revision: 2,
		verifiedAt: at
	});
	expect(JSON.stringify(response.body)).not.toMatch(
		/supportingEvidence|reviewer-1|applicant|trusted-authority-check/
	);
	expect(
		(await request(f.app).get('/verify/testnet/' + address)).body.verification
	).toBeNull();
	await request(f.app)
		.post(`/verify/applications/${application.id}/resubmit`)
		.send({ ...submission, revision: 2 })
		.expect(409);
	await request(f.app)
		.post(`/verify/applications/${application.id}/decisions`)
		.send({
			...approval,
			revision: 2,
			state: 'revoked',
			reason: 'Identity evidence withdrawn'
		})
		.expect(200);
	expect(
		(await request(f.app).get('/verify/mainnet/' + address)).body.verification
	).toBeNull();
	f.setReviewer(null);
	await request(f.app)
		.post(`/verify/applications/${application.id}/resubmit`)
		.send({ ...submission, revision: 3 })
		.expect(200);
	expect(f.applications.get(application.id)?.state).toBe('pending');
	expect(f.applications.get(application.id)?.review).toBeNull();
	expect(f.events.map((event) => event.action)).toEqual([
		'submitted',
		'approved',
		'revoked',
		'resubmitted'
	]);
});
it('preserves one decision and audit event when two reviewers race on the same revision', async () => {
	const f = fixture();
	const application = await f.workflow.submit(
		'applicant',
		submission,
		f.control
	);
	const results = await Promise.allSettled([
		f.workflow.review(application.id, reviewer, approval, f.control),
		f.workflow.review(
			application.id,
			{ ...reviewer, subjectId: 'reviewer-2' },
			approval,
			f.control
		)
	]);
	expect(
		results.filter((result) => result.status === 'fulfilled')
	).toHaveLength(1);
	expect(results.filter((result) => result.status === 'rejected')).toHaveLength(
		1
	);
	expect(f.events).toHaveLength(2);
});
it('authorizes the bounded private queue and sanitizes unexpected failures', async () => {
	const f = fixture();
	await f.workflow.submit('applicant', submission, f.control);
	await request(f.app).get('/verify/review').expect(403);
	f.setReviewer(reviewer);
	expect(
		(await request(f.app).get('/verify/review').expect(200)).body.items
	).toHaveLength(1);
	await request(f.app).get('/verify/review?after=bad').expect(400);
	f.store.approved = async () => {
		throw new Error(submission.supportingEvidence);
	};
	const response = await request(f.app)
		.get('/verify/mainnet/' + address)
		.expect(503);
	expect(JSON.stringify(response.body)).not.toContain(
		submission.supportingEvidence
	);
});

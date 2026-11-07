import { randomUUID } from 'node:crypto';
import {
	assertControl,
	publicVerification,
	text,
	VerificationError,
	type Application,
	type ControlEvidence,
	type Decision,
	type Network,
	type Submission
} from './VerificationApplication.js';

export interface Reviewer {
	readonly subjectId: string;
	readonly role: 'identity-reviewer';
}
export interface ApplicationEvent {
	readonly actor: string;
	readonly action: 'submitted' | 'resubmitted' | Decision['state'];
	readonly application: Application;
}
export interface VerificationStore {
	create(application: Application, event: ApplicationEvent): Promise<void>;
	find(id: string): Promise<Application | null>;
	update(
		expectedRevision: number,
		application: Application,
		event: ApplicationEvent
	): Promise<void>;
	queue(after: string, limit: number): Promise<readonly Application[]>;
	approved(network: Network, address: string): Promise<Application | null>;
}
export class VerificationWorkflow {
	constructor(
		private readonly store: VerificationStore,
		private readonly now: () => Date = () => new Date()
	) {}

	async submit(
		subjectId: string,
		input: Submission,
		control: ControlEvidence | null
	): Promise<Application> {
		const applicantId = text(subjectId, 200);
		const now = this.now();
		assertControl(control, applicantId, input, now);
		const application: Application = {
			...input,
			id: randomUUID(),
			applicantId,
			control,
			state: 'pending',
			revision: 1,
			submittedAt: now.toISOString(),
			updatedAt: now.toISOString(),
			review: null
		};
		await this.store.create(application, {
			actor: applicantId,
			action: 'submitted',
			application
		});
		return application;
	}
	async read(
		id: string,
		subjectId: string,
		reviewer?: Reviewer | null
	): Promise<Application> {
		const application = await this.requireApplication(id);
		if (application.applicantId !== subjectId && !this.isReviewer(reviewer))
			throw new VerificationError(404, 'Application not found');
		return application;
	}
	async resubmit(
		id: string,
		subjectId: string,
		revision: number,
		input: Submission,
		control: ControlEvidence | null
	): Promise<Application> {
		const previous = await this.read(id, subjectId);
		if (
			previous.revision !== revision ||
			!['changes_requested', 'rejected', 'revoked'].includes(previous.state) ||
			input.address !== previous.address ||
			input.network !== previous.network
		)
			throw new VerificationError(
				409,
				'Application changed or cannot be resubmitted'
			);
		const now = this.now();
		assertControl(control, subjectId, input, now);
		const application: Application = {
			...previous,
			...input,
			control,
			state: 'pending',
			revision: previous.revision + 1,
			updatedAt: now.toISOString(),
			review: null
		};
		await this.store.update(previous.revision, application, {
			actor: subjectId,
			action: 'resubmitted',
			application
		});
		return application;
	}
	async review(
		id: string,
		reviewer: Reviewer | null,
		decision: Decision,
		control: ControlEvidence | null
	): Promise<Application> {
		if (!this.isReviewer(reviewer))
			throw new VerificationError(403, 'Identity reviewer permission required');
		const previous = await this.requireApplication(id);
		if (previous.applicantId === reviewer.subjectId)
			throw new VerificationError(
				403,
				'A reviewer cannot decide their own application'
			);
		const allowed =
			previous.state === 'approved'
				? decision.state === 'revoked'
				: previous.state === 'pending' &&
					['changes_requested', 'approved', 'rejected'].includes(
						decision.state
					);
		if (previous.revision !== decision.revision || !allowed)
			throw new VerificationError(
				409,
				'Application changed or decision is not allowed'
			);
		const now = this.now();
		if (decision.state === 'approved') {
			if (!decision.identityEvidenceReviewed)
				throw new VerificationError(
					400,
					'Review the claimed identity separately from account control'
				);
			assertControl(control, previous.applicantId, previous, now);
		}
		const application: Application = {
			...previous,
			control:
				decision.state === 'approved' && control ? control : previous.control,
			state: decision.state,
			revision: previous.revision + 1,
			updatedAt: now.toISOString(),
			review: {
				reviewerId: reviewer.subjectId,
				reason: decision.reason,
				identityEvidenceReviewed: decision.identityEvidenceReviewed,
				at: now.toISOString()
			}
		};
		await this.store.update(previous.revision, application, {
			actor: reviewer.subjectId,
			action: decision.state,
			application
		});
		return application;
	}
	queue(reviewer: Reviewer | null, after: string) {
		if (!this.isReviewer(reviewer))
			throw new VerificationError(403, 'Identity reviewer permission required');
		return this.store.queue(after, 20);
	}
	async public(network: Network, address: string) {
		return publicVerification(await this.store.approved(network, address));
	}
	private isReviewer(
		reviewer: Reviewer | null | undefined
	): reviewer is Reviewer {
		return (
			reviewer?.role === 'identity-reviewer' &&
			!!reviewer.subjectId &&
			reviewer.subjectId.length <= 200
		);
	}
	private async requireApplication(id: string): Promise<Application> {
		if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))
			throw new VerificationError(404, 'Application not found');
		const application = await this.store.find(id);
		if (!application) throw new VerificationError(404, 'Application not found');
		return application;
	}
}

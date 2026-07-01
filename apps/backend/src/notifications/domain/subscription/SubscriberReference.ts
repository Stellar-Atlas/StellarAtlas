import { Column, Index } from 'typeorm';
import { randomUUID } from 'crypto';
import { err, ok, Result } from 'neverthrow';
import validator from 'validator';

export class SubscriberReference {
	@Index()
	@Column({ type: 'uuid', nullable: false })
	public readonly value: string;

	private constructor(value: string) {
		this.value = value;
	}

	static create(): SubscriberReference {
		return new SubscriberReference(randomUUID());
	}

	static createFromValue(value: string): Result<SubscriberReference, Error> {
		if (!validator.isUUID(value))
			return err(new Error('Not a valid SubscriberReference'));
		else return ok(new SubscriberReference(value));
	}
}

import { 
	Entity, 
	PrimaryColumn, 
	Column, 
	CreateDateColumn, 
	UpdateDateColumn, 
	BeforeInsert,
	BeforeUpdate,
	Index
} from 'typeorm';
import { IsEmail, IsNotEmpty, IsUUID } from 'class-validator';
import { randomUUID } from 'crypto';

@Entity('users')
export class User {
	@PrimaryColumn('uuid')
	@IsUUID(4)
	id!: string;

	@Column({ type: 'varchar', length: 255, unique: true })
	@Index('IDX_users_email', { unique: true })
	@IsEmail()
	@IsNotEmpty()
	private _email!: string;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt!: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt!: Date;

	// Email getter and setter with normalization
	get email(): string {
		return this._email;
	}

	set email(value: string) {
		this._email = value?.trim().toLowerCase();
	}

	@BeforeInsert()
	setCreatedAt() {
		if (!this.id) {
			this.id = randomUUID();
		}
		this.createdAt = new Date();
		this.updatedAt = new Date();
	}

	@BeforeUpdate()
	setUpdatedAt() {
		this.updatedAt = new Date();
	}

	equals(other: User | null): boolean {
		if (!other) {
			return false;
		}
		return this.id === other.id;
	}
}
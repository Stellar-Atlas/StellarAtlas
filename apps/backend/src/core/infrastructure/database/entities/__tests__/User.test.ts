import { User } from '../User';
import { randomUUID } from 'crypto';
import { validate } from 'class-validator';

describe('User Entity', () => {
	describe('validation', () => {
		it('should create valid user with all required fields', async () => {
			const user = new User();
			user.id = randomUUID();
			user.email = 'test@example.com';
			user.createdAt = new Date();
			user.updatedAt = new Date();

			const errors = await validate(user);
			expect(errors).toHaveLength(0);
		});

		it('should fail validation with invalid email format', async () => {
			const user = new User();
			user.id = randomUUID();
			user.email = 'invalid-email';
			user.createdAt = new Date();
			user.updatedAt = new Date();

			const errors = await validate(user);
			expect(errors.length).toBeGreaterThan(0);
			expect(errors[0].constraints).toHaveProperty('isEmail');
		});

		it('should fail validation with missing email', async () => {
			const user = new User();
			user.id = randomUUID();
			user.createdAt = new Date();
			user.updatedAt = new Date();

			const errors = await validate(user);
			expect(errors.length).toBeGreaterThan(0);
			expect(errors[0].constraints).toHaveProperty('isNotEmpty');
		});

		it('should fail validation with invalid UUID', async () => {
			const user = new User();
			user.id = 'invalid-uuid';
			user.email = 'test@example.com';
			user.createdAt = new Date();
			user.updatedAt = new Date();

			const errors = await validate(user);
			expect(errors.length).toBeGreaterThan(0);
			expect(errors[0].constraints).toHaveProperty('isUuid');
		});

		it('should have email normalized to lowercase', () => {
			const user = new User();
			user.email = 'TEST@EXAMPLE.COM';

			expect(user.email).toBe('test@example.com');
		});

		it('should trim whitespace from email', () => {
			const user = new User();
			user.email = '  test@example.com  ';

			expect(user.email).toBe('test@example.com');
		});
	});

	describe('timestamps', () => {
		it('should set createdAt on creation', () => {
			const user = new User();
			user.setCreatedAt();

			expect(user.createdAt).toBeInstanceOf(Date);
			expect(user.createdAt.getTime()).toBeCloseTo(Date.now(), -1000); // Within 1 second
		});

		it('should update updatedAt when modified', () => {
			const user = new User();
			const originalDate = new Date('2020-01-01');
			user.createdAt = originalDate;
			user.updatedAt = originalDate;

			user.setUpdatedAt();

			expect(user.updatedAt).toBeInstanceOf(Date);
			expect(user.updatedAt.getTime()).toBeGreaterThan(originalDate.getTime());
		});
	});

	describe('equals', () => {
		it('should return true for users with same id', () => {
			const id = randomUUID();
			const user1 = new User();
			user1.id = id;
			user1.email = 'test1@example.com';

			const user2 = new User();
			user2.id = id;
			user2.email = 'test2@example.com';

			expect(user1.equals(user2)).toBe(true);
		});

		it('should return false for users with different ids', () => {
			const user1 = new User();
			user1.id = randomUUID();
			user1.email = 'test@example.com';

			const user2 = new User();
			user2.id = randomUUID();
			user2.email = 'test@example.com';

			expect(user1.equals(user2)).toBe(false);
		});

		it('should return false when comparing with null', () => {
			const user = new User();
			user.id = randomUUID();

			expect(user.equals(null)).toBe(false);
		});
	});
});
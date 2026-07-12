export class ScpStatementPersistenceTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Canonical SCP persistence did not settle within ${timeoutMs}ms`);
		this.name = 'ScpStatementPersistenceTimeoutError';
	}
}

export class ScpStatementPersistenceCapacityError extends Error {
	constructor(capacity: number) {
		super(`Canonical SCP persistence buffer reached its ${capacity}-row limit`);
		this.name = 'ScpStatementPersistenceCapacityError';
	}
}

export class ScpStatementPersistenceClosedError extends Error {
	constructor() {
		super('Canonical SCP persistence buffer is closed');
		this.name = 'ScpStatementPersistenceClosedError';
	}
}

import { err, ok, Result } from 'neverthrow';
import { inject, injectable } from 'inversify';
import type { Logger } from 'logger';
import { Ajv, type ValidateFunction } from 'ajv';
import {
	HistoryArchiveState,
	HistoryArchiveStateSchema
} from './HistoryArchiveState.js';
import { CustomError } from 'custom-error';

export class InvalidHistoryArchiveStateError extends CustomError {
	constructor(message: string) {
		super('Invalid history archive state file: ' + message, InvalidHistoryArchiveStateError.name);
	}
}

@injectable()
export class HistoryArchiveStateValidator {
	private readonly validateHistoryArchiveState: ValidateFunction<HistoryArchiveState>;

	constructor(@inject('Logger') protected logger: Logger) {
		const ajv = new Ajv();
		this.validateHistoryArchiveState = ajv.compile(HistoryArchiveStateSchema); //todo this probably needs to move higher up the chain...
	}

	validate(
		historyArchiveStateRaw: Record<string, unknown>
	): Result<HistoryArchiveState, InvalidHistoryArchiveStateError> {
		const validate = this.validateHistoryArchiveState;
		if (validate(historyArchiveStateRaw)) {
			return ok(historyArchiveStateRaw);
		}

		const errors = validate.errors;
		if (errors === undefined || errors === null)
			return err(new InvalidHistoryArchiveStateError('Unknown error'));
		return err(new InvalidHistoryArchiveStateError(errors.toString()));
	}
}

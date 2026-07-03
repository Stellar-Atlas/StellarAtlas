import 'reflect-metadata';
import { injectable } from 'inversify';
import { ok, Result } from 'neverthrow';
import type { ApiStatusDTO } from '../../domain/StatusTypes.js';

@injectable()
export class GetApiStatus {
	execute(): Result<ApiStatusDTO, Error> {
		return ok({
			generatedAt: new Date().toISOString(),
			status: 'ok',
			service: 'api'
		});
	}
}

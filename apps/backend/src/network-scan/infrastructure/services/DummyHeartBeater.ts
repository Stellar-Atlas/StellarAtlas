import { injectable } from 'inversify';
import { ok, Result } from 'neverthrow';
import type { HeartBeater } from '@core/services/HeartBeater.js';

@injectable()
export class DummyHeartBeater implements HeartBeater {
	tick() {
		return new Promise<Result<void, Error>>((resolve) =>
			resolve(ok(undefined))
		);
	}
}

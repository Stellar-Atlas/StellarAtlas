import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { err, ok, type Result } from 'neverthrow';
import type {
	HistoryArchiveContentReuseRequestV1,
	HistoryArchiveReusableContentResponse
} from 'shared';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { lookupReusableHistoryArchiveContent } from '../../infrastructure/repositories/database/HistoryArchiveContentReuseLookup.js';

@injectable()
export class GetHistoryArchiveContentReuse {
	constructor(@inject(DataSource) private readonly dataSource: DataSource) {}

	async execute(
		request: HistoryArchiveContentReuseRequestV1
	): Promise<Result<HistoryArchiveReusableContentResponse | null, Error>> {
		try {
			return ok(
				await lookupReusableHistoryArchiveContent(
					this.dataSource.manager,
					request
				)
			);
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}

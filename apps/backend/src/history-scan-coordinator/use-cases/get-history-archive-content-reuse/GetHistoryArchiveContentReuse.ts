import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { err, ok, type Result } from 'neverthrow';
import type {
	HistoryArchiveContentReuseRequestV1,
	HistoryArchiveReusableContentV1
} from 'shared';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { findReusableHistoryArchiveContent } from '../../infrastructure/repositories/database/HistoryArchiveContentReuseWrite.js';

@injectable()
export class GetHistoryArchiveContentReuse {
	constructor(@inject(DataSource) private readonly dataSource: DataSource) {}

	async execute(
		request: HistoryArchiveContentReuseRequestV1
	): Promise<Result<HistoryArchiveReusableContentV1 | null, Error>> {
		try {
			return ok(
				await findReusableHistoryArchiveContent(
					this.dataSource.manager,
					request
				)
			);
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}

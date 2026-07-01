import { GetMeasurementsDTO } from './GetMeasurementsDTO.js';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '../../../core/utilities/mapUnknownToError.js';
import type { ExceptionLogger } from '../../../core/services/ExceptionLogger.js';
import type { MeasurementRepository } from '../../domain/measurement/MeasurementRepository.js';
import { Measurement } from '../../domain/measurement/Measurement.js';

export class GetMeasurements {
	constructor(
		private measurementRepository: MeasurementRepository<Measurement>,
		private exceptionLogger: ExceptionLogger
	) {}

	public async execute(
		dto: GetMeasurementsDTO
	): Promise<Result<Measurement[], Error>> {
		try {
			return ok(
				await this.measurementRepository.findBetween(dto.id, dto.from, dto.to)
			);
		} catch (error) {
			this.exceptionLogger.captureException(mapUnknownToError(error));
			return err(mapUnknownToError(error));
		}
	}
}

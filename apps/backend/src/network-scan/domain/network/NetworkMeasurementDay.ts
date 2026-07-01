import { Entity } from 'typeorm';
import { NetworkMeasurementAggregation } from './NetworkMeasurementAggregation.js';

@Entity()
export default class NetworkMeasurementDay extends NetworkMeasurementAggregation {}

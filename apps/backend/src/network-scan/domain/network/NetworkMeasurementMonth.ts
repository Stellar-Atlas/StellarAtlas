import { Entity } from 'typeorm';
import { NetworkMeasurementAggregation } from './NetworkMeasurementAggregation.js';

@Entity()
export default class NetworkMeasurementMonth extends NetworkMeasurementAggregation {}

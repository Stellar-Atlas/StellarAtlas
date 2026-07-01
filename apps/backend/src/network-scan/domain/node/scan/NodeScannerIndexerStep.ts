import { injectable } from 'inversify';
import { StellarCoreVersion } from '../../network/StellarCoreVersion.js';
import { NodeMeasurementAverage } from '../NodeMeasurementAverage.js';
import { NodeScan } from './NodeScan.js';
import { NodeIndexer } from './NodeIndexer.js';
import 'reflect-metadata';

@injectable()
export class NodeScannerIndexerStep {
	public execute(
		nodeScan: NodeScan,
		measurement30DayAverages: NodeMeasurementAverage[],
		stellarCoreVersion: StellarCoreVersion
	): void {
		nodeScan.updateIndexes(
			NodeIndexer.calculateIndexes(
				nodeScan.nodes,
				measurement30DayAverages,
				stellarCoreVersion
			)
		);
	}
}

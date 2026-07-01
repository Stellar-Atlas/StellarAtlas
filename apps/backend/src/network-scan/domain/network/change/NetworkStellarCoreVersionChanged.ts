import { ChildEntity } from 'typeorm';
import { NetworkChange } from './NetworkChange.js';
import { NetworkId } from '../NetworkId.js';
import { StellarCoreVersion } from '../StellarCoreVersion.js';

@ChildEntity()
export class NetworkStellarCoreVersionChanged extends NetworkChange {
	constructor(
		networkId: NetworkId,
		time: Date,
		from: StellarCoreVersion,
		to: StellarCoreVersion
	) {
		super(
			networkId,
			time,
			{
				value: from
			},
			{
				value: to
			}
		);
	}
}

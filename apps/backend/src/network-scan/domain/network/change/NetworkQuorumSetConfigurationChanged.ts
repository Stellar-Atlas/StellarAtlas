import { ChildEntity } from 'typeorm';
import { NetworkChange } from './NetworkChange.js';
import { NetworkId } from '../NetworkId.js';
import { NetworkQuorumSetConfiguration } from '../NetworkQuorumSetConfiguration.js';

@ChildEntity()
export class NetworkQuorumSetConfigurationChanged extends NetworkChange {
	constructor(
		networkId: NetworkId,
		time: Date,
		from: NetworkQuorumSetConfiguration,
		to: NetworkQuorumSetConfiguration
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

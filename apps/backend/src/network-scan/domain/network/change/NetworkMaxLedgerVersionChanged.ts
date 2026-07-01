import { ChildEntity } from 'typeorm';
import { NetworkChange } from './NetworkChange.js';
import { NetworkId } from '../NetworkId.js';

@ChildEntity()
export class NetworkMaxLedgerVersionChanged extends NetworkChange {
	constructor(networkId: NetworkId, time: Date, from: number, to: number) {
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

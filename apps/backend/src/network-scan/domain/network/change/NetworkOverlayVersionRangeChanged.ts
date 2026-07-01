import { ChildEntity } from 'typeorm';
import { NetworkChange } from './NetworkChange.js';
import { NetworkId } from '../NetworkId.js';
import { OverlayVersionRange } from '../OverlayVersionRange.js';

@ChildEntity()
export class NetworkOverlayVersionRangeChanged extends NetworkChange {
	constructor(
		networkId: NetworkId,
		time: Date,
		from: OverlayVersionRange,
		to: OverlayVersionRange
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

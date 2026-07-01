import PublicKey from '../node/PublicKey.js';
import { NetworkId } from '../network/NetworkId.js';
import { OrganizationId } from '../organization/OrganizationId.js';

export type MeasurementAggregationSourceId =
	PublicKey | NetworkId | OrganizationId;

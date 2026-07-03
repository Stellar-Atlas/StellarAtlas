import { interfaces } from 'inversify';
import { GetLatestFbas } from '../../use-cases/get-latest-fbas/GetLatestFbas.js';
import { GetTopTierHistory } from '../../use-cases/get-top-tier-history/GetTopTierHistory.js';
import Container = interfaces.Container;

export function load(container: Container) {
	container.bind(GetLatestFbas).toSelf();
	container.bind(GetTopTierHistory).toSelf();
}

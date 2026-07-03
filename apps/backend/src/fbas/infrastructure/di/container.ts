import { interfaces } from 'inversify';
import { GetLatestFbas } from '../../use-cases/get-latest-fbas/GetLatestFbas.js';
import Container = interfaces.Container;

export function load(container: Container) {
	container.bind(GetLatestFbas).toSelf();
}

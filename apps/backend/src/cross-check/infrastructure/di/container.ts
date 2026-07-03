import { interfaces } from 'inversify';
import { GetCrossCheckSources } from '../../use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import Container = interfaces.Container;

export function load(container: Container) {
	container.bind(GetCrossCheckSources).toSelf();
}

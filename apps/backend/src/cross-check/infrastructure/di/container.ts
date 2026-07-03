import { interfaces } from 'inversify';
import { GetCrossCheckArchives } from '../../use-cases/get-cross-check-archives/GetCrossCheckArchives.js';
import { GetCrossCheckSources } from '../../use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import { GetCrossCheckValidators } from '../../use-cases/get-cross-check-validators/GetCrossCheckValidators.js';
import Container = interfaces.Container;

export function load(container: Container) {
	container.bind(GetCrossCheckArchives).toSelf();
	container.bind(GetCrossCheckSources).toSelf();
	container.bind(GetCrossCheckValidators).toSelf();
}

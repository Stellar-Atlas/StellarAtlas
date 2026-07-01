import { GetNetwork } from '../GetNetwork.js';
import { mock } from 'jest-mock-extended';
import { err } from 'neverthrow';
import type { ExceptionLogger } from '../../../../core/services/ExceptionLogger.js';
import { NetworkDTOService } from '../../../services/NetworkDTOService.js';
import { CachedNetworkDTOService } from '../../../services/CachedNetworkDTOService.js';

it('should capture and return network errors', async function () {
	const networkDTOService = mock<CachedNetworkDTOService>();
	networkDTOService.getNetworkDTOAt.mockResolvedValue(err(new Error('test')));
	const exceptionLogger = mock<ExceptionLogger>();
	const getNetwork = new GetNetwork(networkDTOService, exceptionLogger);
	const result = await getNetwork.execute({ at: new Date() });
	expect(result.isErr()).toBe(true);
	expect(exceptionLogger.captureException).toHaveBeenCalledTimes(1);
});

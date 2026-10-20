import express, { type Router } from 'express';
import { StrKey } from '@stellar/stellar-sdk';
import {
	ContractProvenanceService,
	ProvenanceBusy
} from './ContractProvenanceService.js';

export function contractProvenanceRouter(config: {
	readonly rpcUrl?: string;
	readonly networkPassphrase: string;
}): Router {
	const service = new ContractProvenanceService(
		config.rpcUrl ? new URL(config.rpcUrl) : undefined,
		config.networkPassphrase
	);
	const router = express.Router();
	router.get('/contracts/:contractId/provenance', async (request, response) => {
		const contractId = request.params.contractId ?? '';
		if (!StrKey.isValidContract(contractId)) {
			response.status(400).json({
				code: 'invalid_contract',
				error: 'A valid C-address is required'
			});
			return;
		}
		try {
			const result = await service.get(contractId);
			response.setHeader('Cache-Control', 'public, max-age=30');
			response.json(result);
		} catch (error) {
			response.setHeader('Cache-Control', 'no-store');
			response.setHeader('Retry-After', '30');
			response.status(503).json({
				code:
					error instanceof ProvenanceBusy
						? 'verification_busy'
						: 'contract_evidence_unavailable',
				error:
					error instanceof ProvenanceBusy
						? 'Build verification is busy; retry shortly'
						: 'Contract evidence is temporarily unavailable'
			});
		}
	});
	return router;
}

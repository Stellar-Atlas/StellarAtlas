import type express from 'express';
import {
	isProtocolPositionAccount,
	type createGetExplorerAccountProtocolPosition
} from '../../use-cases/get-explorer-account-protocol-position/GetExplorerAccountProtocolPosition.js';

/** Exported for explicit composition. This module mounts no route. */
export function createExplorerAccountProtocolPositionHandler(
	useCase: ReturnType<typeof createGetExplorerAccountProtocolPosition>
): express.RequestHandler<{ accountId: string }> {
	return async (req, res) => {
		res.setHeader('Cache-Control', 'no-store');
		const { accountId } = req.params;
		if (
			!isProtocolPositionAccount(accountId) ||
			Object.keys(req.query).length !== 0
		)
			return res
				.status(400)
				.json({ error: 'invalid_protocol_position_request' });
		const result = await useCase.execute(accountId);
		return res.status(result.status === 'unavailable' ? 503 : 200).json(result);
	};
}

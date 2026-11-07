import {
	fetchRpcJson,
	ProvenanceHttpError
} from '../http/contract-provenance/BoundedProvenanceJson.js';
import { scopedRpcEndpoint } from '../http/contract-provenance/ProvenanceEndpointPolicy.js';

export async function fetchProtocolRpcJson(
	url: URL,
	body: object,
	options: Parameters<typeof fetchRpcJson>[2] = {}
): Promise<unknown> {
	const endpoint = scopedRpcEndpoint(url.href);
	if (!endpoint)
		throw new ProvenanceHttpError(
			null,
			'transport',
			'Unapproved protocol RPC endpoint'
		);
	return fetchRpcJson(endpoint, body, options);
}

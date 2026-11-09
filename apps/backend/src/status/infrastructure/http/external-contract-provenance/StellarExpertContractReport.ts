import { createHash } from 'node:crypto';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import { record } from '../contract-provenance/ContractBuildAttestation.js';
import {
	InvalidExpertObservation,
	parseExpertValidationObservation,
	type ExpertValidationObservation
} from './ExpertValidationObservation.js';

const contractDetailUrl =
	/^https:\/\/api\.stellar\.expert\/explorer\/(public|testnet)\/contract\/(C[A-Z2-7]{55})$/;
const maxUnixSeconds = 253402300799;

/**
 * Map already-decoded Contract info data from the StellarExpert v0.3.0 API reference.
 * https://stellar.expert/api-docs/contract-api/queryContractStats
 * The caller supplies capture metadata. This performs no fetch or attestation check.
 */
export function mapStellarExpertContractReport(
	body: unknown,
	capture: { readonly requestUrl: string; readonly fetchedAt: string }
): ExpertValidationObservation | null {
	const { requestUrl, fetchedAt } = capture;
	const match =
		typeof requestUrl === 'string' && requestUrl.length <= 110
			? contractDetailUrl.exec(requestUrl)
			: null;
	const network = match?.[1];
	const contractId = match?.[2];
	const detail = record(body);
	if (
		!network ||
		!contractId ||
		match?.[0] !== requestUrl ||
		!StrKey.isValidContract(contractId) ||
		detail.contract !== contractId
	)
		throw new InvalidExpertObservation(
			'StellarExpert contract identity mismatch'
		);
	if (detail.validation == null) return null;
	const validation = record(detail.validation);
	const { status, ts, repository, commit } = validation;
	if (status !== 'verified' && status !== 'unverified')
		throw new InvalidExpertObservation(
			'Invalid StellarExpert validation status'
		);
	if (
		(repository !== undefined &&
			(typeof repository !== 'string' ||
				repository.length > 159 ||
				!repository.startsWith('https://github.com/'))) ||
		(commit !== undefined &&
			(typeof commit !== 'string' || commit.length !== 40)) ||
		typeof fetchedAt !== 'string' ||
		fetchedAt.length !== 24
	)
		throw new InvalidExpertObservation('Invalid StellarExpert source metadata');
	let reportedAt: string | undefined;
	if (ts !== undefined) {
		if (
			typeof ts !== 'number' ||
			!Number.isSafeInteger(ts) ||
			ts < 0 ||
			ts > maxUnixSeconds
		)
			throw new InvalidExpertObservation(
				'Invalid StellarExpert validation timestamp'
			);
		reportedAt = new Date(ts * 1000).toISOString();
	}

	const passphrase = network === 'public' ? Networks.PUBLIC : Networks.TESTNET;
	return parseExpertValidationObservation(
		Buffer.from(
			JSON.stringify({
				version: 1,
				publisher: 'StellarExpert',
				recordId: `${network}:${contractId}`,
				networkId: createHash('sha256').update(passphrase).digest('hex'),
				contractId,
				// ContractInfo.wasm describes the instance, while validation has no digest.
				wasmSha256: null,
				fetchedAt,
				reportedAt,
				providerStatus: status,
				sourceRepo:
					repository === undefined
						? undefined
						: 'github:' + repository.slice('https://github.com/'.length),
				sourceCommit: commit,
				evidenceUrls: [requestUrl]
			})
		)
	);
}

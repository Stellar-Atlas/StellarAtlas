import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { HistoryArchiveEvidenceV2Schema } from 'shared';
import type { PublicHistoryArchiveEvidence } from './archive-evidence-types';

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateHistoryArchiveEvidence = ajv.compile(
	HistoryArchiveEvidenceV2Schema
);

export function parseHistoryArchiveEvidence(
	value: unknown
): PublicHistoryArchiveEvidence {
	if (!validateHistoryArchiveEvidence(value)) {
		throw new Error('Archive evidence response did not match the v2 contract');
	}

	return value;
}
